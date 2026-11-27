-- =====================================================================
-- DailyKart: purchase orders, goods received, purchase returns
--   * purchase order (PO) to a supplier, sent on WhatsApp
--   * goods received against a PO: part deliveries, free pieces, and
--     damaged pieces turned back at the door
--   * purchase return / debit note: stock goes back to the supplier and
--     what you owe them goes down
-- Only adds things. The old "New purchase" keeps working.
-- Safe to run more than once.
-- =====================================================================

-- ---------- Document numbers per store and financial year (Apr-Mar)
create table if not exists public.doc_counters (
  location_id uuid not null references public.locations(id) on delete cascade,
  kind text not null,
  fy text not null,
  last_no integer not null default 0,
  primary key (location_id, kind, fy)
);
alter table public.doc_counters enable row level security;
revoke all on public.doc_counters from anon, authenticated;
grant all on public.doc_counters to service_role;

create or replace function public.next_doc_number(p_location_id uuid, p_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_start integer := case when extract(month from v_today) >= 4 then extract(year from v_today)::int else extract(year from v_today)::int - 1 end;
  v_fy text := lpad((v_start % 100)::text, 2, '0') || '-' || lpad(((v_start + 1) % 100)::text, 2, '0');
  v_no integer;
  v_prefix text;
begin
  insert into public.doc_counters (location_id, kind, fy, last_no) values (p_location_id, p_kind, v_fy, 1)
  on conflict (location_id, kind, fy) do update set last_no = public.doc_counters.last_no + 1
  returning last_no into v_no;
  select coalesce(nullif(trim(invoice_prefix), ''), 'DK') into v_prefix from public.locations where id = p_location_id;
  return coalesce(v_prefix, 'DK') || '/' || p_kind || '/' || v_fy || '/' || lpad(v_no::text, 4, '0');
end;
$$;
revoke all on function public.next_doc_number(uuid, text) from public, anon, authenticated;

-- ---------- Purchase orders
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'partial', 'received', 'cancelled')),
  expected_date date,
  note text,
  total_amount numeric(12,2) not null default 0,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_purchase_orders_location on public.purchase_orders(location_id, created_at desc);
create index if not exists idx_purchase_orders_supplier on public.purchase_orders(supplier_id);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric(10,3) not null check (quantity > 0),
  unit_cost numeric(10,2) not null default 0 check (unit_cost >= 0),
  gst_rate numeric(5,2) not null default 0,
  received_qty numeric(10,3) not null default 0,
  free_qty numeric(10,3) not null default 0,
  damaged_qty numeric(10,3) not null default 0
);
create index if not exists idx_po_items_po on public.purchase_order_items(po_id);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
drop policy if exists "store read purchase_orders" on public.purchase_orders;
create policy "store read purchase_orders" on public.purchase_orders for select to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or ((has_perm('purchases') or has_perm('accounts')) and location_id = get_user_location(auth.uid())));
drop policy if exists "store read purchase_order_items" on public.purchase_order_items;
create policy "store read purchase_order_items" on public.purchase_order_items for select to authenticated
  using (exists (select 1 from public.purchase_orders po where po.id = po_id));
grant select on public.purchase_orders, public.purchase_order_items to authenticated;
grant all on public.purchase_orders, public.purchase_order_items to service_role;

-- Bills can point to the PO they came from; lines can have free and damaged pieces
alter table public.purchases add column if not exists po_id uuid references public.purchase_orders(id) on delete set null;
alter table public.purchase_items add column if not exists free_quantity numeric(10,3) not null default 0;
alter table public.purchase_items add column if not exists damaged_quantity numeric(10,3) not null default 0;

create or replace function public.create_purchase_order(
  p_supplier_id uuid,
  p_items jsonb,
  p_expected_date date default null,
  p_note text default null
)
returns public.purchase_orders
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_supplier public.suppliers;
  v_po public.purchase_orders;
  v_item record;
  v_prod public.products;
  v_total numeric := 0;
begin
  if v_user is null then raise exception 'Please sign in again'; end if;
  if not public.has_perm('purchases') then raise exception 'Your role doesn''t allow purchases'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item';
  end if;
  select * into v_supplier from public.suppliers where id = p_supplier_id;
  if not found then raise exception 'Supplier not found'; end if;
  if public.get_user_role(v_user) <> 'admin' and v_supplier.location_id <> public.get_user_location(v_user) then
    raise exception 'This supplier belongs to another store';
  end if;

  insert into public.purchase_orders (po_number, supplier_id, location_id, expected_date, note, created_by)
  values (public.next_doc_number(v_supplier.location_id, 'PO'), v_supplier.id, v_supplier.location_id,
          p_expected_date, nullif(trim(coalesce(p_note, '')), ''), v_user)
  returning * into v_po;

  for v_item in
    select (e->>'product_id')::uuid as product_id, (e->>'quantity')::numeric as quantity,
           coalesce((e->>'unit_cost')::numeric, 0) as unit_cost, coalesce((e->>'gst_rate')::numeric, 0) as gst_rate
    from jsonb_array_elements(p_items) e
  loop
    if v_item.quantity is null or v_item.quantity <= 0 then raise exception 'Quantity must be more than 0'; end if;
    if v_item.unit_cost < 0 then raise exception 'Cost can''t be negative'; end if;
    select * into v_prod from public.products where id = v_item.product_id;
    if not found then raise exception 'Product not found'; end if;
    if v_prod.location_id <> v_supplier.location_id then raise exception '% belongs to another store', v_prod.name; end if;
    insert into public.purchase_order_items (po_id, product_id, quantity, unit_cost, gst_rate)
    values (v_po.id, v_prod.id, v_item.quantity, v_item.unit_cost, v_item.gst_rate);
    v_total := v_total + round(v_item.quantity * v_item.unit_cost * (1 + v_item.gst_rate / 100), 2);
  end loop;

  update public.purchase_orders set total_amount = v_total where id = v_po.id returning * into v_po;
  return v_po;
end;
$$;
grant execute on function public.create_purchase_order(uuid, jsonb, date, text) to authenticated;

create or replace function public.cancel_purchase_order(p_po_id uuid)
returns public.purchase_orders
language plpgsql security definer set search_path = public as $$
declare v_po public.purchase_orders;
begin
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if v_po.id is null then raise exception 'Order not found'; end if;
  if not public.has_perm('purchases')
     or (public.get_user_role(auth.uid()) <> 'admin' and v_po.location_id <> public.get_user_location(auth.uid())) then
    raise exception 'Your role doesn''t allow purchases';
  end if;
  if v_po.status = 'received' then raise exception 'This order is already fully received'; end if;
  update public.purchase_orders set status = 'cancelled', updated_at = now() where id = p_po_id returning * into v_po;
  return v_po;
end;
$$;
grant execute on function public.cancel_purchase_order(uuid) to authenticated;

-- ---------- Goods received (GRN): saves the supplier bill like create_purchase,
-- with free and damaged pieces, and updates the PO when there is one.
--   p_items: [{"product_id": "...", "quantity": 10, "free_qty": 1, "damaged_qty": 2,
--              "unit_cost": 42.5, "gst_rate": 5, "po_item_id": "..."}]
--   quantity = good pieces you pay for; free_qty = extra pieces at no cost;
--   damaged_qty = pieces sent back at the door (not paid, not in stock).
create or replace function public.receive_goods(
  p_supplier_id uuid,
  p_items jsonb,
  p_bill_number text default null,
  p_bill_date date default null,
  p_paid_amount numeric default 0,
  p_paid_method text default 'cash',
  p_note text default null,
  p_po_id uuid default null
)
returns public.purchases
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_supplier public.suppliers;
  v_po public.purchase_orders;
  v_purchase public.purchases;
  v_item record;
  v_prod public.products;
  v_taxable numeric;
  v_gst numeric;
  v_sum_taxable numeric := 0;
  v_sum_tax numeric := 0;
  v_in numeric;
  v_open integer;
begin
  if v_user is null then raise exception 'Please sign in again'; end if;
  if not public.has_perm('purchases') then raise exception 'Your role doesn''t allow purchases'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item';
  end if;
  select * into v_supplier from public.suppliers where id = p_supplier_id;
  if not found then raise exception 'Supplier not found'; end if;
  if public.get_user_role(v_user) <> 'admin' and v_supplier.location_id <> public.get_user_location(v_user) then
    raise exception 'This supplier belongs to another store';
  end if;
  if p_po_id is not null then
    select * into v_po from public.purchase_orders where id = p_po_id for update;
    if v_po.id is null then raise exception 'Order not found'; end if;
    if v_po.supplier_id <> v_supplier.id then raise exception 'This order is for another supplier'; end if;
    if v_po.status in ('received', 'cancelled') then raise exception 'This order is already %', v_po.status; end if;
  end if;

  insert into public.purchases (supplier_id, bill_number, bill_date, note, created_by, location_id, po_id)
  values (v_supplier.id, nullif(trim(coalesce(p_bill_number, '')), ''), coalesce(p_bill_date, (now() at time zone 'Asia/Kolkata')::date),
          nullif(trim(coalesce(p_note, '')), ''), v_user, v_supplier.location_id, p_po_id)
  returning * into v_purchase;

  for v_item in
    select (e->>'product_id')::uuid as product_id,
           coalesce((e->>'quantity')::numeric, 0) as quantity,
           coalesce((e->>'free_qty')::numeric, 0) as free_qty,
           coalesce((e->>'damaged_qty')::numeric, 0) as damaged_qty,
           coalesce((e->>'unit_cost')::numeric, 0) as unit_cost,
           coalesce((e->>'gst_rate')::numeric, 0) as gst_rate,
           nullif(e->>'po_item_id', '')::uuid as po_item_id
    from jsonb_array_elements(p_items) e
    order by 1
  loop
    if v_item.quantity < 0 or v_item.free_qty < 0 or v_item.damaged_qty < 0 then raise exception 'Quantities can''t be negative'; end if;
    if v_item.quantity <> trunc(v_item.quantity) or v_item.free_qty <> trunc(v_item.free_qty) then
      raise exception 'Use whole pieces';
    end if;
    if v_item.unit_cost < 0 then raise exception 'Cost can''t be negative'; end if;
    v_in := v_item.quantity + v_item.free_qty;
    if v_in = 0 and v_item.damaged_qty = 0 then continue; end if;

    select * into v_prod from public.products where id = v_item.product_id for update;
    if not found then raise exception 'Product not found'; end if;
    if v_prod.location_id <> v_supplier.location_id then raise exception '% belongs to another store', v_prod.name; end if;

    if v_in > 0 then
      v_taxable := round(v_item.unit_cost * v_item.quantity, 2);
      v_gst := round(v_taxable * v_item.gst_rate / 100, 2);
      -- quantity on the line = pieces into stock (paid + free)
      insert into public.purchase_items (purchase_id, product_id, quantity, unit_cost, gst_rate, gst_amount, total, free_quantity, damaged_quantity)
      values (v_purchase.id, v_prod.id, v_in, v_item.unit_cost, v_item.gst_rate, v_gst, v_taxable + v_gst, v_item.free_qty, v_item.damaged_qty);

      update public.products
      set stock_quantity = coalesce(stock_quantity, 0) + v_in::integer,
          old_purchase_price = case when v_item.quantity > 0 then coalesce(new_purchase_price, cost_price) else old_purchase_price end,
          new_purchase_price = case when v_item.quantity > 0 then v_item.unit_cost else new_purchase_price end,
          cost_price = case when v_item.quantity > 0 then v_item.unit_cost else cost_price end
      where id = v_prod.id;

      v_sum_taxable := v_sum_taxable + v_taxable;
      v_sum_tax := v_sum_tax + v_gst;
    end if;

    if v_item.po_item_id is not null then
      update public.purchase_order_items
      set received_qty = received_qty + v_item.quantity,
          free_qty = free_qty + v_item.free_qty,
          damaged_qty = damaged_qty + v_item.damaged_qty
      where id = v_item.po_item_id and po_id = p_po_id and product_id = v_prod.id;
      if not found then raise exception 'That line is not on this order'; end if;
    end if;
  end loop;

  if not exists (select 1 from public.purchase_items where purchase_id = v_purchase.id) then
    raise exception 'Nothing received: enter at least one good or free piece';
  end if;

  update public.purchases
  set taxable_amount = v_sum_taxable, tax_amount = v_sum_tax, total_amount = v_sum_taxable + v_sum_tax
  where id = v_purchase.id
  returning * into v_purchase;

  if p_po_id is not null then
    select count(*) into v_open from public.purchase_order_items where po_id = p_po_id and received_qty < quantity;
    update public.purchase_orders set status = case when v_open = 0 then 'received' else 'partial' end, updated_at = now()
    where id = p_po_id;
  end if;

  if coalesce(p_paid_amount, 0) > 0 then
    insert into public.supplier_payments (supplier_id, amount, method, note, created_by)
    values (v_supplier.id, p_paid_amount, coalesce(p_paid_method, 'cash'),
            'Paid with bill ' || coalesce(v_purchase.bill_number, ''), v_user);
  end if;
  return v_purchase;
end;
$$;
grant execute on function public.receive_goods(uuid, jsonb, text, date, numeric, text, text, uuid) to authenticated;

-- ---------- Purchase returns (debit notes)
create table if not exists public.purchase_returns (
  id uuid primary key default gen_random_uuid(),
  return_number text not null,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  purchase_id uuid references public.purchases(id) on delete set null,
  location_id uuid not null references public.locations(id) on delete restrict,
  reason text,
  taxable_amount numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_purchase_returns_location on public.purchase_returns(location_id, created_at desc);
create index if not exists idx_purchase_returns_supplier on public.purchase_returns(supplier_id);

create table if not exists public.purchase_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.purchase_returns(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric(10,3) not null check (quantity > 0),
  unit_cost numeric(10,2) not null default 0,
  gst_rate numeric(5,2) not null default 0,
  gst_amount numeric(10,2) not null default 0,
  total numeric(12,2) not null default 0
);
create index if not exists idx_purchase_return_items_return on public.purchase_return_items(return_id);

alter table public.purchase_returns enable row level security;
alter table public.purchase_return_items enable row level security;
drop policy if exists "store read purchase_returns" on public.purchase_returns;
create policy "store read purchase_returns" on public.purchase_returns for select to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or ((has_perm('purchases') or has_perm('accounts')) and location_id = get_user_location(auth.uid())));
drop policy if exists "store read purchase_return_items" on public.purchase_return_items;
create policy "store read purchase_return_items" on public.purchase_return_items for select to authenticated
  using (exists (select 1 from public.purchase_returns r where r.id = return_id));
grant select on public.purchase_returns, public.purchase_return_items to authenticated;
grant all on public.purchase_returns, public.purchase_return_items to service_role;

--   p_items: [{"product_id": "...", "quantity": 2, "unit_cost": 40, "gst_rate": 5}]
create or replace function public.create_purchase_return(
  p_supplier_id uuid,
  p_items jsonb,
  p_reason text default null,
  p_purchase_id uuid default null
)
returns public.purchase_returns
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_supplier public.suppliers;
  v_ret public.purchase_returns;
  v_item record;
  v_prod public.products;
  v_taxable numeric;
  v_gst numeric;
  v_sum_taxable numeric := 0;
  v_sum_tax numeric := 0;
begin
  if v_user is null then raise exception 'Please sign in again'; end if;
  if not public.has_perm('purchases') then raise exception 'Your role doesn''t allow purchases'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item';
  end if;
  select * into v_supplier from public.suppliers where id = p_supplier_id;
  if not found then raise exception 'Supplier not found'; end if;
  if public.get_user_role(v_user) <> 'admin' and v_supplier.location_id <> public.get_user_location(v_user) then
    raise exception 'This supplier belongs to another store';
  end if;
  if p_purchase_id is not null and not exists (select 1 from public.purchases where id = p_purchase_id and supplier_id = v_supplier.id) then
    raise exception 'That bill is not from this supplier';
  end if;

  insert into public.purchase_returns (return_number, supplier_id, purchase_id, location_id, reason, created_by)
  values (public.next_doc_number(v_supplier.location_id, 'DN'), v_supplier.id, p_purchase_id, v_supplier.location_id,
          nullif(trim(coalesce(p_reason, '')), ''), v_user)
  returning * into v_ret;

  for v_item in
    select (e->>'product_id')::uuid as product_id, (e->>'quantity')::numeric as quantity,
           coalesce((e->>'unit_cost')::numeric, 0) as unit_cost, coalesce((e->>'gst_rate')::numeric, 0) as gst_rate
    from jsonb_array_elements(p_items) e
    order by 1
  loop
    if v_item.quantity is null or v_item.quantity <= 0 or v_item.quantity <> trunc(v_item.quantity) then
      raise exception 'Quantity must be a whole number more than 0';
    end if;
    if v_item.unit_cost < 0 then raise exception 'Cost can''t be negative'; end if;
    select * into v_prod from public.products where id = v_item.product_id for update;
    if not found then raise exception 'Product not found'; end if;
    if v_prod.location_id <> v_supplier.location_id then raise exception '% belongs to another store', v_prod.name; end if;
    if coalesce(v_prod.stock_quantity, 0) < v_item.quantity then
      raise exception 'Only % of % in stock to send back', coalesce(v_prod.stock_quantity, 0), v_prod.name;
    end if;

    v_taxable := round(v_item.unit_cost * v_item.quantity, 2);
    v_gst := round(v_taxable * v_item.gst_rate / 100, 2);
    insert into public.purchase_return_items (return_id, product_id, quantity, unit_cost, gst_rate, gst_amount, total)
    values (v_ret.id, v_prod.id, v_item.quantity, v_item.unit_cost, v_item.gst_rate, v_gst, v_taxable + v_gst);

    perform set_config('dailykart.stock_src', 'purchase_return|' || v_ret.id::text || '|' || v_prod.id::text, true);
    update public.products set stock_quantity = coalesce(stock_quantity, 0) - v_item.quantity::integer where id = v_prod.id;

    v_sum_taxable := v_sum_taxable + v_taxable;
    v_sum_tax := v_sum_tax + v_gst;
  end loop;

  update public.purchase_returns
  set taxable_amount = v_sum_taxable, tax_amount = v_sum_tax, total_amount = v_sum_taxable + v_sum_tax
  where id = v_ret.id
  returning * into v_ret;
  return v_ret;
end;
$$;
grant execute on function public.create_purchase_return(uuid, jsonb, text, uuid) to authenticated;

-- ---------- What you owe suppliers now takes away purchase returns
drop view if exists public.supplier_balances;
create view public.supplier_balances with (security_invoker = true) as
select
  s.id as supplier_id,
  s.name,
  s.phone,
  s.gstin,
  s.location_id,
  (greatest(s.opening_balance, 0) + coalesce(pu.total, 0))::numeric(12,2) as purchase_total,
  (greatest(-s.opening_balance, 0) + coalesce(pd.total, 0) + coalesce(pr.total, 0))::numeric(12,2) as paid_total,
  (s.opening_balance + coalesce(pu.total, 0) - coalesce(pd.total, 0) - coalesce(pr.total, 0))::numeric(12,2) as balance,
  greatest(pu.last_at, pd.last_at, pr.last_at) as last_activity,
  s.opening_balance,
  s.credit_days,
  s.credit_limit,
  (select min(x.at) from (
     select o.at, sum(o.amt) over (order by o.at, o.k rows unbounded preceding) as cum
     from (
       select s.created_at as at, 0 as k, greatest(s.opening_balance, 0) as amt
       union all
       select p.created_at, 1, p.total_amount from public.purchases p where p.supplier_id = s.id
     ) o where o.amt > 0
   ) x
   where x.cum > greatest(-s.opening_balance, 0) + coalesce(pd.total, 0) + coalesce(pr.total, 0) + 0.005
  ) as oldest_due_at,
  coalesce(pr.total, 0)::numeric(12,2) as returns_total
from public.suppliers s
left join (select supplier_id, sum(total_amount) as total, max(created_at) as last_at
           from public.purchases group by supplier_id) pu on pu.supplier_id = s.id
left join (select supplier_id, sum(amount) as total, max(created_at) as last_at
           from public.supplier_payments where reversed_at is null group by supplier_id) pd on pd.supplier_id = s.id
left join (select supplier_id, sum(total_amount) as total, max(created_at) as last_at
           from public.purchase_returns group by supplier_id) pr on pr.supplier_id = s.id;
grant select on public.supplier_balances to authenticated;

-- ---------- Audit the new tables too
do $$
declare t text;
begin
  if to_regprocedure('public.audit_row()') is not null then
    foreach t in array array['purchase_orders', 'purchase_returns'] loop
      execute format('drop trigger if exists trg_audit on public.%I', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';
