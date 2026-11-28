-- =====================================================================
-- DailyKart step 9: purchases and suppliers
--
-- Enter a supplier's bill: stock goes up, cost price is updated, input
-- GST is recorded, and what you owe the supplier is tracked.
-- Safe to run more than once.
-- =====================================================================

alter table public.suppliers add column if not exists gstin text;
alter table public.suppliers add column if not exists state_code text;

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  bill_number text,
  bill_date date not null default current_date,
  taxable_amount numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  note text,
  created_by uuid not null references auth.users(id),
  location_id uuid not null references public.locations(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists idx_purchases_location on public.purchases(location_id);
create index if not exists idx_purchases_supplier on public.purchases(supplier_id);
create index if not exists idx_purchases_bill_date on public.purchases(bill_date);

create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric(10,3) not null check (quantity > 0),
  unit_cost numeric(10,2) not null check (unit_cost >= 0),
  gst_rate numeric(5,2) not null default 0,
  gst_amount numeric(10,2) not null default 0,
  total numeric(12,2) not null default 0
);
create index if not exists idx_purchase_items_purchase on public.purchase_items(purchase_id);

create table if not exists public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  method text not null default 'cash' check (method in ('cash', 'upi', 'card', 'bank', 'cheque')),
  note text,
  created_by uuid not null default auth.uid() references auth.users(id),
  location_id uuid references public.locations(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists idx_supplier_payments_supplier on public.supplier_payments(supplier_id);

alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.supplier_payments enable row level security;

drop policy if exists "store read purchases" on public.purchases;
create policy "store read purchases" on public.purchases for select to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or (get_user_role(auth.uid()) = 'manager' and location_id = get_user_location(auth.uid())));
drop policy if exists "store read purchase_items" on public.purchase_items;
create policy "store read purchase_items" on public.purchase_items for select to authenticated
  using (exists (select 1 from public.purchases p where p.id = purchase_id));
drop policy if exists "store read supplier_payments" on public.supplier_payments;
create policy "store read supplier_payments" on public.supplier_payments for select to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or (get_user_role(auth.uid()) = 'manager' and location_id = get_user_location(auth.uid())));
drop policy if exists "manager insert supplier_payments" on public.supplier_payments;
create policy "manager insert supplier_payments" on public.supplier_payments for insert to authenticated
  with check (get_user_role(auth.uid()) = 'admin'
              or (get_user_role(auth.uid()) = 'manager' and location_id = get_user_location(auth.uid())));

grant select on public.purchases, public.purchase_items to authenticated;
grant select, insert on public.supplier_payments to authenticated;
grant all on public.purchases, public.purchase_items, public.supplier_payments to service_role;

-- Payment goes to the supplier's store
create or replace function public.set_supplier_payment_location()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select s.location_id into new.location_id from public.suppliers s where s.id = new.supplier_id;
  if new.location_id is null then raise exception 'Supplier not found'; end if;
  return new;
end;
$$;
drop trigger if exists supplier_payments_set_location on public.supplier_payments;
create trigger supplier_payments_set_location before insert on public.supplier_payments
  for each row execute function public.set_supplier_payment_location();

-- ---------------------------------------------------------------------
-- create_purchase: saves the supplier bill, adds stock and updates cost
-- price in one transaction. Managers and admins only.
--   p_items: [{"product_id": "...", "quantity": 10, "unit_cost": 42.5, "gst_rate": 5}]
--   unit_cost is per unit BEFORE GST.
-- ---------------------------------------------------------------------
create or replace function public.create_purchase(
  p_supplier_id uuid,
  p_items jsonb,
  p_bill_number text default null,
  p_bill_date date default null,
  p_paid_amount numeric default 0,
  p_paid_method text default 'cash',
  p_note text default null
)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_supplier public.suppliers;
  v_purchase public.purchases;
  v_item record;
  v_prod public.products;
  v_taxable numeric;
  v_gst numeric;
  v_sum_taxable numeric := 0;
  v_sum_tax numeric := 0;
begin
  if v_user is null then raise exception 'Please sign in again'; end if;
  v_role := public.get_user_role(v_user);
  if v_role not in ('admin', 'manager') then
    raise exception 'Only a manager or admin can enter purchases';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item';
  end if;

  select * into v_supplier from public.suppliers where id = p_supplier_id;
  if not found then raise exception 'Supplier not found'; end if;
  if v_role <> 'admin' and v_supplier.location_id <> public.get_user_location(v_user) then
    raise exception 'This supplier belongs to another store';
  end if;

  insert into public.purchases (supplier_id, bill_number, bill_date, note, created_by, location_id)
  values (v_supplier.id, nullif(trim(coalesce(p_bill_number, '')), ''), coalesce(p_bill_date, (now() at time zone 'Asia/Kolkata')::date),
          nullif(trim(coalesce(p_note, '')), ''), v_user, v_supplier.location_id)
  returning * into v_purchase;

  for v_item in
    select (e->>'product_id')::uuid as product_id,
           (e->>'quantity')::numeric as quantity,
           coalesce((e->>'unit_cost')::numeric, 0) as unit_cost,
           coalesce((e->>'gst_rate')::numeric, 0) as gst_rate
    from jsonb_array_elements(p_items) e
    order by 1
  loop
    if v_item.quantity is null or v_item.quantity <= 0 then
      raise exception 'Quantity must be more than 0';
    end if;
    if v_item.unit_cost < 0 then raise exception 'Cost can''t be negative'; end if;

    select * into v_prod from public.products where id = v_item.product_id for update;
    if not found then raise exception 'Product not found'; end if;
    if v_prod.location_id <> v_supplier.location_id then
      raise exception '% belongs to another store', v_prod.name;
    end if;

    v_taxable := round(v_item.unit_cost * v_item.quantity, 2);
    v_gst := round(v_taxable * v_item.gst_rate / 100, 2);

    insert into public.purchase_items (purchase_id, product_id, quantity, unit_cost, gst_rate, gst_amount, total)
    values (v_purchase.id, v_prod.id, v_item.quantity, v_item.unit_cost, v_item.gst_rate, v_gst, v_taxable + v_gst);

    update public.products
    set stock_quantity = coalesce(stock_quantity, 0) + v_item.quantity,
        old_purchase_price = coalesce(new_purchase_price, cost_price),
        new_purchase_price = v_item.unit_cost,
        cost_price = v_item.unit_cost
    where id = v_prod.id;

    v_sum_taxable := v_sum_taxable + v_taxable;
    v_sum_tax := v_sum_tax + v_gst;
  end loop;

  update public.purchases
  set taxable_amount = v_sum_taxable, tax_amount = v_sum_tax, total_amount = v_sum_taxable + v_sum_tax
  where id = v_purchase.id
  returning * into v_purchase;

  if coalesce(p_paid_amount, 0) > 0 then
    insert into public.supplier_payments (supplier_id, amount, method, note, created_by)
    values (v_supplier.id, p_paid_amount, coalesce(p_paid_method, 'cash'),
            'Paid with bill ' || coalesce(v_purchase.bill_number, ''), v_user);
  end if;

  return v_purchase;
end;
$$;

revoke all on function public.create_purchase(uuid, jsonb, text, date, numeric, text, text) from public, anon;
grant execute on function public.create_purchase(uuid, jsonb, text, date, numeric, text, text) to authenticated;

-- What you owe each supplier (follows the viewer's access rules)
drop view if exists public.supplier_balances;
create view public.supplier_balances with (security_invoker = true) as
select
  s.id as supplier_id,
  s.name,
  s.phone,
  s.gstin,
  s.location_id,
  coalesce(pu.total, 0)::numeric(12,2) as purchase_total,
  coalesce(pd.total, 0)::numeric(12,2) as paid_total,
  (coalesce(pu.total, 0) - coalesce(pd.total, 0))::numeric(12,2) as balance,
  greatest(pu.last_at, pd.last_at) as last_activity
from public.suppliers s
left join (select supplier_id, sum(total_amount) as total, max(created_at) as last_at
           from public.purchases group by supplier_id) pu on pu.supplier_id = s.id
left join (select supplier_id, sum(amount) as total, max(created_at) as last_at
           from public.supplier_payments group by supplier_id) pd on pd.supplier_id = s.id;

grant select on public.supplier_balances to authenticated;

notify pgrst, 'reload schema';
