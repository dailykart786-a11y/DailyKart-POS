-- =====================================================================
-- DailyKart: customer orders and home delivery
--   * take orders by phone, WhatsApp or at the counter (later: online)
--   * delivery or pickup, expected time, delivery person from the staff list
--   * status: new -> packing -> ready -> out for delivery -> delivered
--     (or cancelled)
--   * bill the order with one tap: it goes through the normal billing
--     (create_sale / create_sale_split), so stock, GST, khata and books
--     work exactly as for a counter bill. An order is billed only once.
-- Uses the "sales" permission. Only adds things. Safe to run more than once.
-- =====================================================================

create table if not exists public.customer_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null,
  location_id uuid not null references public.locations(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text,
  phone text,
  address text,
  channel text not null default 'phone' check (channel in ('phone', 'whatsapp', 'counter', 'online')),
  delivery_type text not null default 'delivery' check (delivery_type in ('delivery', 'pickup')),
  status text not null default 'new' check (status in ('new', 'packing', 'ready', 'out_for_delivery', 'delivered', 'cancelled')),
  expected_at timestamptz,
  assigned_staff_id uuid references public.staff(id) on delete set null,
  note text,
  estimated_total numeric(12,2) not null default 0,
  sale_id uuid references public.sales(id) on delete set null,
  cancel_reason text,
  packed_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_customer_orders_loc_status on public.customer_orders(location_id, status, created_at desc);
create unique index if not exists uq_customer_orders_sale on public.customer_orders(sale_id) where sale_id is not null;

create table if not exists public.customer_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.customer_orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  name text not null,
  quantity numeric(10,3) not null check (quantity > 0),
  price numeric(10,2) not null default 0
);
create index if not exists idx_customer_order_items_order on public.customer_order_items(order_id);

alter table public.customer_orders enable row level security;
alter table public.customer_order_items enable row level security;

create or replace function public.can_handle_orders(p_location_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.get_user_role(auth.uid()) = 'admin'
      or (public.has_perm('sales') and p_location_id = public.get_user_location(auth.uid()))
$$;
grant execute on function public.can_handle_orders(uuid) to authenticated;

drop policy if exists "read customer_orders" on public.customer_orders;
create policy "read customer_orders" on public.customer_orders for select to authenticated
  using (public.can_handle_orders(location_id));
drop policy if exists "read customer_order_items" on public.customer_order_items;
create policy "read customer_order_items" on public.customer_order_items for select to authenticated
  using (exists (select 1 from public.customer_orders o where o.id = order_id));
-- the delivery person and the note can be changed directly; everything else goes through the functions
drop policy if exists "update customer_orders" on public.customer_orders;
create policy "update customer_orders" on public.customer_orders for update to authenticated
  using (public.can_handle_orders(location_id)) with check (public.can_handle_orders(location_id));
grant select on public.customer_orders, public.customer_order_items to authenticated;
grant update (assigned_staff_id, note, expected_at, address, phone) on public.customer_orders to authenticated;
grant all on public.customer_orders, public.customer_order_items to service_role;

create or replace function public.customer_orders_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_customer_orders_touch on public.customer_orders;
create trigger trg_customer_orders_touch before update on public.customer_orders
  for each row execute function public.customer_orders_touch();

--   p_items: [{"product_id": "...", "quantity": 2}, ...]
create or replace function public.create_customer_order(
  p_items jsonb,
  p_customer_id uuid default null,
  p_customer_name text default null,
  p_phone text default null,
  p_address text default null,
  p_channel text default 'phone',
  p_delivery_type text default 'delivery',
  p_expected_at timestamptz default null,
  p_note text default null,
  p_location_id uuid default null
)
returns public.customer_orders language plpgsql security definer set search_path = public as $$
declare
  v_loc uuid := case when public.get_user_role(auth.uid()) = 'admin' then coalesce(p_location_id, public.get_user_location(auth.uid()))
                     else public.get_user_location(auth.uid()) end;
  v_cust public.customers;
  v_row public.customer_orders;
  v_item record;
  v_prod public.products;
  v_total numeric := 0;
begin
  if auth.uid() is null then raise exception 'Please sign in again'; end if;
  if v_loc is null then raise exception 'Pick a store first'; end if;
  if not public.can_handle_orders(v_loc) then raise exception 'Your role doesn''t allow orders'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item'; end if;
  if p_customer_id is not null then
    select * into v_cust from public.customers where id = p_customer_id and location_id = v_loc;
    if v_cust.id is null then raise exception 'Customer not found in this store'; end if;
  end if;
  if coalesce(nullif(trim(p_customer_name), ''), v_cust.name) is null then raise exception 'Enter the customer''s name'; end if;
  if coalesce(p_delivery_type, 'delivery') = 'delivery' and coalesce(nullif(trim(p_address), ''), v_cust.address) is null then
    raise exception 'Enter the delivery address';
  end if;

  insert into public.customer_orders (order_number, location_id, customer_id, customer_name, phone, address, channel, delivery_type,
                                      expected_at, note)
  values (public.next_doc_number(v_loc, 'ORD'), v_loc, v_cust.id,
          coalesce(nullif(trim(p_customer_name), ''), v_cust.name), coalesce(nullif(trim(p_phone), ''), v_cust.phone),
          coalesce(nullif(trim(p_address), ''), v_cust.address), coalesce(p_channel, 'phone'), coalesce(p_delivery_type, 'delivery'),
          p_expected_at, nullif(trim(p_note), ''))
  returning * into v_row;

  for v_item in select (e->>'product_id')::uuid as product_id, coalesce((e->>'quantity')::numeric, 0) as quantity
                from jsonb_array_elements(p_items) e loop
    if v_item.quantity <= 0 then raise exception 'Quantity must be more than 0'; end if;
    select * into v_prod from public.products where id = v_item.product_id and location_id = v_loc;
    if v_prod.id is null then raise exception 'A product in this order is not in this store'; end if;
    insert into public.customer_order_items (order_id, product_id, name, quantity, price)
    values (v_row.id, v_prod.id, v_prod.name, v_item.quantity, coalesce(v_prod.price, 0));
    v_total := v_total + round(v_item.quantity * coalesce(v_prod.price, 0) * (1 + coalesce(v_prod.gst_rate, 0) / 100), 2);  -- about: offers apply at billing
  end loop;
  update public.customer_orders set estimated_total = v_total where id = v_row.id returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.create_customer_order(jsonb, uuid, text, text, text, text, text, timestamptz, text, uuid) to authenticated;

create or replace function public.set_order_status(p_order_id uuid, p_status text, p_reason text default null)
returns public.customer_orders language plpgsql security definer set search_path = public as $$
declare
  v_row public.customer_orders;
begin
  select * into v_row from public.customer_orders where id = p_order_id for update;
  if v_row.id is null or not public.can_handle_orders(v_row.location_id) then raise exception 'Order not found'; end if;
  if p_status not in ('new', 'packing', 'ready', 'out_for_delivery', 'delivered', 'cancelled') then raise exception 'Unknown status'; end if;
  if v_row.status in ('delivered', 'cancelled') then raise exception 'This order is already %', replace(v_row.status, '_', ' '); end if;
  if p_status = 'out_for_delivery' and v_row.delivery_type <> 'delivery' then raise exception 'This is a pickup order'; end if;
  if p_status = 'delivered' and v_row.sale_id is null then raise exception 'Bill the order before marking it delivered'; end if;
  if p_status = 'cancelled' and v_row.sale_id is not null then
    raise exception 'This order is already billed. Make a return for the bill first, then cancel.';
  end if;
  update public.customer_orders set
    status = p_status,
    packed_at = case when p_status in ('ready', 'out_for_delivery', 'delivered') then coalesce(packed_at, now()) else packed_at end,
    dispatched_at = case when p_status = 'out_for_delivery' then now() else dispatched_at end,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
    cancel_reason = case when p_status = 'cancelled' then nullif(trim(p_reason), '') else cancel_reason end
  where id = p_order_id
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.set_order_status(uuid, text, text) to authenticated;

-- Bill through the normal billing so stock, GST, khata limits and books all apply.
--   p_payments (optional) for a split bill: {"cash": 100, "upi": 50, "credit": 20}
create or replace function public.bill_customer_order(p_order_id uuid, p_payment_method text default 'cash', p_payments jsonb default null)
returns public.sales language plpgsql security definer set search_path = public as $$
declare
  v_row public.customer_orders;
  v_items jsonb;
  v_sale public.sales;
begin
  select * into v_row from public.customer_orders where id = p_order_id for update;
  if v_row.id is null or not public.can_handle_orders(v_row.location_id) then raise exception 'Order not found'; end if;
  if v_row.sale_id is not null then raise exception 'This order is already billed'; end if;
  if v_row.status = 'cancelled' then raise exception 'This order was cancelled'; end if;
  if p_payment_method = 'credit' and v_row.customer_id is null then
    raise exception 'Pick a saved customer on the order to bill it on udhaar';
  end if;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity)) into v_items
  from public.customer_order_items where order_id = v_row.id;
  if v_items is null then raise exception 'The order has no items'; end if;

  if p_payments is not null and jsonb_typeof(p_payments) = 'object' then
    v_sale := public.create_sale_split(v_items, p_payments, v_row.customer_id, v_row.location_id);
  else
    v_sale := public.create_sale(v_items, v_row.customer_id, coalesce(p_payment_method, 'cash'), v_row.location_id);
  end if;
  update public.customer_orders set sale_id = v_sale.id,
    status = case when status = 'new' then 'packing' else status end
  where id = v_row.id;
  return v_sale;
end;
$$;
grant execute on function public.bill_customer_order(uuid, text, jsonb) to authenticated;

do $$ begin
  if to_regprocedure('public.audit_row()') is not null then
    execute 'drop trigger if exists trg_audit on public.customer_orders';
    execute 'create trigger trg_audit after insert or update or delete on public.customer_orders for each row execute function public.audit_row()';
  end if;
end $$;

notify pgrst, 'reload schema';
