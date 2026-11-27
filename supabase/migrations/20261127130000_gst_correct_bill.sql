-- =====================================================================
-- DailyKart step 3: GST-correct bills
--
-- Includes everything from step 1, so it works whether or not step 1 was run.
-- Safe to run more than once. Only ADDS columns and updates create_sale().
-- The app keeps working if this has not been run yet.
-- =====================================================================

-- From step 1 (repeated so this file also works on its own)
alter table public.locations add column if not exists invoice_prefix text not null default 'DK';
create table if not exists public.invoice_counters (
  prefix text not null,
  financial_year text not null,
  last_number integer not null default 0,
  primary key (prefix, financial_year)
);
alter table public.invoice_counters enable row level security;
grant select, insert, update on public.invoice_counters to service_role;

-- Shop details printed on the bill (one set per store)
alter table public.locations add column if not exists business_name text;
alter table public.locations add column if not exists gstin text;
alter table public.locations add column if not exists state_code text;   -- e.g. 36 = Telangana
alter table public.locations add column if not exists phone text;
alter table public.locations add column if not exists email text;
alter table public.locations add column if not exists bill_footer text;

-- HSN code per product
alter table public.products add column if not exists hsn_code text;

-- Business customers: GSTIN and state (for IGST on other-state sales)
alter table public.customers add column if not exists gstin text;
alter table public.customers add column if not exists state_code text;

-- Keep the tax details as they were at the moment of sale
alter table public.sale_items add column if not exists gst_rate numeric(5,2);
alter table public.sale_items add column if not exists hsn_code text;
alter table public.sale_items add column if not exists discount_percent numeric(5,2) default 0;
alter table public.sales add column if not exists is_interstate boolean not null default false;

-- Fill the rate for old bills from today's product rate (best guess)
update public.sale_items si
set gst_rate = coalesce(p.gst_rate, 0), hsn_code = coalesce(si.hsn_code, p.hsn_code)
from public.products p
where si.product_id = p.id and si.gst_rate is null;

-- Admins edit shop details; managers too for their own store
drop policy if exists "managers update own location" on public.locations;
create policy "managers update own location" on public.locations for update to authenticated
  using (get_user_role(auth.uid()) = 'manager' and id = get_user_location(auth.uid()))
  with check (get_user_role(auth.uid()) = 'manager' and id = get_user_location(auth.uid()));

-- create_sale now also saves GST rate, HSN and the interstate flag
drop function if exists public.create_sale(jsonb, uuid, text);
drop function if exists public.create_sale(jsonb, uuid, text, uuid);

create or replace function public.create_sale(
  p_items jsonb,
  p_customer_id uuid default null,
  p_payment_method text default 'cash'
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_is_admin boolean;
  v_location uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_fy_start int;
  v_fy text;
  v_prefix text;
  v_num int;
  v_invoice text;
  v_sale public.sales;
  v_item record;
  v_prod public.products;
  v_qty numeric;
  v_disc_pct numeric;
  v_base numeric;
  v_disc numeric;
  v_after numeric;
  v_gst numeric;
  v_sub numeric := 0;
  v_tax numeric := 0;
  v_discount numeric := 0;
  v_store_state text;
  v_cust_state text;
  v_interstate boolean := false;
begin
  if v_user is null then
    raise exception 'Please sign in again';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;
  if coalesce(p_payment_method, '') not in ('cash', 'card', 'upi', 'credit') then
    raise exception 'Unknown payment method: %', p_payment_method;
  end if;

  v_is_admin := public.get_user_role(v_user) = 'admin';
  v_location := coalesce(public.get_user_location(v_user), public.default_location());

  if p_customer_id is not null and not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and (v_is_admin or c.location_id = v_location)
  ) then
    raise exception 'Customer not found';
  end if;

  -- Other-state customer (both state codes known and different) -> IGST
  select nullif(trim(l.state_code), '') into v_store_state from public.locations l where l.id = v_location;
  if p_customer_id is not null then
    select nullif(trim(c.state_code), '') into v_cust_state from public.customers c where c.id = p_customer_id;
  end if;
  v_interstate := v_store_state is not null and v_cust_state is not null and v_store_state <> v_cust_state;

  -- Invoice number: <prefix>/<FY>/<0001>
  v_fy_start := case when extract(month from v_today) >= 4
                     then extract(year from v_today)::int
                     else extract(year from v_today)::int - 1 end;
  v_fy := lpad((v_fy_start % 100)::text, 2, '0') || '-' || lpad(((v_fy_start + 1) % 100)::text, 2, '0');

  select coalesce(nullif(trim(l.invoice_prefix), ''), 'DK') into v_prefix
  from public.locations l where l.id = v_location;
  v_prefix := coalesce(v_prefix, 'DK');

  insert into public.invoice_counters as ic (prefix, financial_year, last_number)
  values (v_prefix, v_fy, 1)
  on conflict (prefix, financial_year)
  do update set last_number = ic.last_number + 1
  returning last_number into v_num;

  v_invoice := v_prefix || '/' || v_fy || '/' || lpad(v_num::text, 4, '0');

  insert into public.sales (invoice_number, customer_id, cashier_id, total_amount,
                            tax_amount, discount_amount, payment_method, location_id, is_interstate)
  values (v_invoice, p_customer_id, v_user, 0, 0, 0, p_payment_method, v_location, v_interstate)
  returning * into v_sale;

  -- Lock products in a fixed order so two sales never deadlock
  for v_item in
    select (e->>'product_id')::uuid as product_id,
           sum(coalesce((e->>'quantity')::numeric, 0)) as quantity,
           max(coalesce((e->>'discount')::numeric, 0)) as discount
    from jsonb_array_elements(p_items) e
    group by 1
    order by 1
  loop
    select * into v_prod from public.products p
    where p.id = v_item.product_id
    for update;

    if not found or not coalesce(v_prod.is_active, true) then
      raise exception 'A product in the cart no longer exists. Refresh and try again.';
    end if;
    if not v_is_admin and v_prod.location_id <> v_location then
      raise exception 'Product % belongs to another store', v_prod.name;
    end if;

    v_qty := v_item.quantity;
    if v_qty <= 0 then
      raise exception 'Quantity for % must be more than 0', v_prod.name;
    end if;
    if coalesce(v_prod.stock_quantity, 0) < v_qty then
      raise exception 'Not enough stock for %: only % left', v_prod.name, coalesce(v_prod.stock_quantity, 0);
    end if;

    v_disc_pct := least(greatest(v_item.discount, 0), 100);
    v_base  := v_prod.price * v_qty;
    v_disc  := round(v_base * v_disc_pct / 100, 2);
    v_after := v_base - v_disc;
    v_gst   := round(v_after * coalesce(v_prod.gst_rate, 0) / 100, 2);

    insert into public.sale_items (sale_id, product_id, quantity, unit_price, total_price, gst_amount,
                                   gst_rate, hsn_code, discount_percent)
    values (v_sale.id, v_prod.id, v_qty, v_prod.price, round(v_after + v_gst, 2), v_gst,
            coalesce(v_prod.gst_rate, 0), v_prod.hsn_code, v_disc_pct);

    update public.products
    set stock_quantity = coalesce(stock_quantity, 0) - v_qty
    where id = v_prod.id;

    v_sub := v_sub + v_after;
    v_tax := v_tax + v_gst;
    v_discount := v_discount + v_disc;
  end loop;

  update public.sales
  set total_amount = round(v_sub + v_tax, 2),
      tax_amount = round(v_tax, 2),
      discount_amount = round(v_discount, 2)
  where id = v_sale.id
  returning * into v_sale;

  return v_sale;
end;
$$;

revoke all on function public.create_sale(jsonb, uuid, text) from public, anon;
grant execute on function public.create_sale(jsonb, uuid, text) to authenticated;

-- Ask the API to pick up the changes right away
notify pgrst, 'reload schema';
