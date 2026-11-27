-- =====================================================================
-- DailyKart step 8: returns and exchanges (credit notes)
--
-- A return is always against a saved bill. Stock goes back, a credit note
-- number is given (e.g. DK/CN/26-27/0001), and the money is refunded in
-- cash/UPI/card or taken off the customer's khata. Safe to run again.
-- =====================================================================

create table if not exists public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  return_number text not null unique,
  sale_id uuid not null references public.sales(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  refund_method text not null check (refund_method in ('cash', 'upi', 'card', 'khata')),
  refund_amount numeric(10,2) not null default 0,
  tax_amount numeric(10,2) not null default 0,
  reason text,
  created_by uuid not null references auth.users(id),
  location_id uuid not null references public.locations(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists idx_sale_returns_sale on public.sale_returns(sale_id);
create index if not exists idx_sale_returns_location on public.sale_returns(location_id);
create index if not exists idx_sale_returns_customer on public.sale_returns(customer_id);

create table if not exists public.sale_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.sale_returns(id) on delete cascade,
  sale_item_id uuid not null references public.sale_items(id) on delete restrict,
  product_id uuid not null references public.products(id),
  quantity numeric(10,3) not null check (quantity > 0),
  amount numeric(10,2) not null,
  gst_amount numeric(10,2) not null default 0
);
create index if not exists idx_sale_return_items_return on public.sale_return_items(return_id);
create index if not exists idx_sale_return_items_sale_item on public.sale_return_items(sale_item_id);

alter table public.sale_returns enable row level security;
alter table public.sale_return_items enable row level security;

drop policy if exists "store read sale_returns" on public.sale_returns;
create policy "store read sale_returns" on public.sale_returns for select to authenticated
  using (get_user_role(auth.uid()) = 'admin' or location_id = get_user_location(auth.uid()));
drop policy if exists "store read sale_return_items" on public.sale_return_items;
create policy "store read sale_return_items" on public.sale_return_items for select to authenticated
  using (exists (select 1 from public.sale_returns r where r.id = return_id
                 and (get_user_role(auth.uid()) = 'admin' or r.location_id = get_user_location(auth.uid()))));
-- No insert/update/delete policies: returns are only made through create_return()

grant select on public.sale_returns, public.sale_return_items to authenticated;
grant all on public.sale_returns, public.sale_return_items to service_role;

-- ---------------------------------------------------------------------
-- create_return(sale, items, refund method, reason)
--   p_items: [{"sale_item_id": "...", "quantity": 1}, ...]
-- Managers and admins only. Can't return more than was sold (minus
-- earlier returns). Puts stock back. All in one transaction.
-- ---------------------------------------------------------------------
create or replace function public.create_return(
  p_sale_id uuid,
  p_items jsonb,
  p_refund_method text default 'cash',
  p_reason text default null
)
returns public.sale_returns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_sale public.sales;
  v_ret public.sale_returns;
  v_item record;
  v_si public.sale_items;
  v_already numeric;
  v_amount numeric;
  v_gst numeric;
  v_total numeric := 0;
  v_tax numeric := 0;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_fy_start int;
  v_fy text;
  v_prefix text;
  v_num int;
begin
  if v_user is null then raise exception 'Please sign in again'; end if;
  v_role := public.get_user_role(v_user);
  if v_role not in ('admin', 'manager') then
    raise exception 'Only a manager or admin can take returns';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Pick at least one item to return';
  end if;
  if coalesce(p_refund_method, '') not in ('cash', 'upi', 'card', 'khata') then
    raise exception 'Unknown refund method: %', p_refund_method;
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Bill not found'; end if;
  if v_role <> 'admin' and v_sale.location_id <> public.get_user_location(v_user) then
    raise exception 'This bill belongs to another store';
  end if;
  if p_refund_method = 'khata' and v_sale.customer_id is null then
    raise exception 'This bill has no customer, so the refund can''t go to khata';
  end if;

  -- Credit note number: <prefix>/CN/<FY>/<0001>
  v_fy_start := case when extract(month from v_today) >= 4
                     then extract(year from v_today)::int
                     else extract(year from v_today)::int - 1 end;
  v_fy := lpad((v_fy_start % 100)::text, 2, '0') || '-' || lpad(((v_fy_start + 1) % 100)::text, 2, '0');
  select coalesce(nullif(trim(l.invoice_prefix), ''), 'DK') into v_prefix from public.locations l where l.id = v_sale.location_id;
  v_prefix := coalesce(v_prefix, 'DK') || '/CN';
  insert into public.invoice_counters as ic (prefix, financial_year, last_number)
  values (v_prefix, v_fy, 1)
  on conflict (prefix, financial_year) do update set last_number = ic.last_number + 1
  returning last_number into v_num;

  insert into public.sale_returns (return_number, sale_id, customer_id, refund_method, reason, created_by, location_id)
  values (v_prefix || '/' || v_fy || '/' || lpad(v_num::text, 4, '0'), v_sale.id, v_sale.customer_id,
          p_refund_method, nullif(trim(coalesce(p_reason, '')), ''), v_user, v_sale.location_id)
  returning * into v_ret;

  for v_item in
    select (e->>'sale_item_id')::uuid as sale_item_id, sum((e->>'quantity')::numeric) as quantity
    from jsonb_array_elements(p_items) e
    group by 1 order by 1
  loop
    if v_item.quantity is null or v_item.quantity <= 0 then
      continue;
    end if;
    select * into v_si from public.sale_items where id = v_item.sale_item_id and sale_id = v_sale.id;
    if not found then raise exception 'Item is not on this bill'; end if;

    select coalesce(sum(ri.quantity), 0) into v_already
    from public.sale_return_items ri where ri.sale_item_id = v_si.id;
    if v_item.quantity > v_si.quantity - v_already then
      raise exception 'Only % of this item can still be returned', trim_scale(v_si.quantity - v_already);
    end if;

    -- Refund the same share of what was paid (after discount, with GST)
    v_amount := round(v_si.total_price * v_item.quantity / v_si.quantity, 2);
    v_gst := round(coalesce(v_si.gst_amount, 0) * v_item.quantity / v_si.quantity, 2);

    insert into public.sale_return_items (return_id, sale_item_id, product_id, quantity, amount, gst_amount)
    values (v_ret.id, v_si.id, v_si.product_id, v_item.quantity, v_amount, v_gst);

    update public.products
    set stock_quantity = coalesce(stock_quantity, 0) + v_item.quantity
    where id = v_si.product_id;

    v_total := v_total + v_amount;
    v_tax := v_tax + v_gst;
  end loop;

  if v_total <= 0 then raise exception 'Pick at least one item to return'; end if;

  update public.sale_returns set refund_amount = v_total, tax_amount = v_tax
  where id = v_ret.id returning * into v_ret;

  return v_ret;
end;
$$;

revoke all on function public.create_return(uuid, jsonb, text, text) from public, anon;
grant execute on function public.create_return(uuid, jsonb, text, text) to authenticated;

-- Khata: a return refunded "to khata" lowers what the customer owes
drop view if exists public.customer_balances;
create view public.customer_balances with (security_invoker = true) as
select
  c.id as customer_id,
  c.name,
  c.phone,
  c.location_id,
  coalesce(cr.total, 0)::numeric(12,2) as credit_total,
  (coalesce(pd.total, 0) + coalesce(rt.total, 0))::numeric(12,2) as paid_total,
  (coalesce(cr.total, 0) - coalesce(pd.total, 0) - coalesce(rt.total, 0))::numeric(12,2) as balance,
  greatest(cr.last_at, pd.last_at, rt.last_at) as last_activity
from public.customers c
left join (
  select customer_id, sum(total_amount) as total, max(created_at) as last_at
  from public.sales
  where payment_method = 'credit' and coalesce(status, 'completed') <> 'cancelled'
  group by customer_id
) cr on cr.customer_id = c.id
left join (
  select customer_id, sum(amount) as total, max(created_at) as last_at
  from public.customer_payments
  group by customer_id
) pd on pd.customer_id = c.id
left join (
  select customer_id, sum(refund_amount) as total, max(created_at) as last_at
  from public.sale_returns
  where refund_method = 'khata'
  group by customer_id
) rt on rt.customer_id = c.id;

grant select on public.customer_balances to authenticated;

notify pgrst, 'reload schema';
