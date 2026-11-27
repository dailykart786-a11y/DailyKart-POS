-- =====================================================================
-- DailyKart: data integrity
--   * stock ledger: every stock change is recorded, with where it came from
--   * bill lines keep the product name and SKU as they were when sold
--   * price change history
--   * MRP on products
--   * saved bills can't be edited or deleted (use a return instead)
--   * no duplicate SKU / barcode in a store (when the data allows it)
--
-- Safe to run more than once. Only ADDS things. To fix a bill by hand in
-- the SQL editor, first run:  select set_config('dailykart.allow_bill_edit', 'on', false);
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Stock ledger (append-only)
-- ---------------------------------------------------------------------
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  movement_type text not null,   -- opening, sale, return, purchase, adjustment, manual
  quantity_change numeric(12,3) not null,
  stock_before numeric(12,3) not null,
  stock_after numeric(12,3) not null,
  source_type text,
  source_id uuid,
  note text,
  unit_cost numeric(10,2),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_movements_product on public.stock_movements(product_id, created_at);
create index if not exists idx_stock_movements_location on public.stock_movements(location_id, created_at desc);
create index if not exists idx_stock_movements_source on public.stock_movements(source_type, source_id);

alter table public.stock_movements enable row level security;
drop policy if exists "store read stock_movements" on public.stock_movements;
create policy "store read stock_movements" on public.stock_movements for select to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or (get_user_role(auth.uid()) <> 'cashier' and location_id = get_user_location(auth.uid())));
grant select on public.stock_movements to authenticated;
-- No insert/update/delete for anyone: rows come only from the triggers below.

-- Source tables tell the product trigger where the change came from.
-- Value: "<type>|<source id>|<product id>", local to the transaction.
create or replace function public.mark_stock_source()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_type text := tg_argv[0]; v_src uuid;
begin
  -- separate branches: each table has only its own column
  if v_type = 'sale' then v_src := new.sale_id;
  elsif v_type = 'return' then v_src := new.return_id;
  elsif v_type = 'purchase' then v_src := new.purchase_id;
  end if;
  perform set_config('dailykart.stock_src', v_type || '|' || coalesce(v_src::text, '') || '|' || new.product_id::text, true);
  return new;
end;
$$;

drop trigger if exists trg_stock_src_sale on public.sale_items;
create trigger trg_stock_src_sale after insert on public.sale_items
  for each row execute function public.mark_stock_source('sale');

do $$ begin
  if to_regclass('public.sale_return_items') is not null then
    execute 'drop trigger if exists trg_stock_src_return on public.sale_return_items';
    execute 'create trigger trg_stock_src_return after insert on public.sale_return_items for each row execute function public.mark_stock_source(''return'')';
  end if;
  if to_regclass('public.purchase_items') is not null then
    execute 'drop trigger if exists trg_stock_src_purchase on public.purchase_items';
    execute 'create trigger trg_stock_src_purchase after insert on public.purchase_items for each row execute function public.mark_stock_source(''purchase'')';
  end if;
end $$;

create or replace function public.log_stock_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_src text := coalesce(current_setting('dailykart.stock_src', true), '');
  v_parts text[] := string_to_array(v_src, '|');
  v_type text := 'manual';
  v_id uuid;
  v_note text;
  v_before numeric := case when tg_op = 'INSERT' then 0 else coalesce(old.stock_quantity, 0) end;
  v_after numeric := coalesce(new.stock_quantity, 0);
begin
  if v_after = v_before then return new; end if;
  if tg_op = 'INSERT' then
    v_type := 'opening';
  elsif array_length(v_parts, 1) = 3 and v_parts[3] = new.id::text then
    v_type := v_parts[1];
    if v_type = 'adjustment' then v_note := nullif(v_parts[2], '');
    else v_id := nullif(v_parts[2], '')::uuid; end if;
  end if;
  insert into public.stock_movements (product_id, location_id, movement_type, quantity_change, stock_before, stock_after,
                                      source_type, source_id, note, unit_cost)
  values (new.id, new.location_id, v_type, v_after - v_before, v_before, v_after,
          case when v_id is not null then v_type end, v_id, v_note, new.cost_price);
  return new;
end;
$$;

drop trigger if exists trg_log_stock_movement on public.products;
create trigger trg_log_stock_movement after insert or update of stock_quantity on public.products
  for each row execute function public.log_stock_movement();

-- Starting balance for products that existed before the ledger
insert into public.stock_movements (product_id, location_id, movement_type, quantity_change, stock_before, stock_after, note, created_by)
select p.id, p.location_id, 'opening', coalesce(p.stock_quantity, 0), 0, coalesce(p.stock_quantity, 0), 'Stock when the ledger started', null
from public.products p
where not exists (select 1 from public.stock_movements m where m.product_id = p.id);

-- adjust_stock(): same as before, and it now names itself as the source
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_quantity integer,
  p_reason text,
  p_mode text default 'change',
  p_note text default null
)
returns public.stock_adjustments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_prod public.products;
  v_before integer;
  v_after integer;
  v_row public.stock_adjustments;
begin
  if v_user is null then raise exception 'Please sign in again'; end if;
  v_role := public.get_user_role(v_user);
  if v_role not in ('admin', 'manager') then
    raise exception 'Only a manager or admin can adjust stock';
  end if;
  if p_quantity is null then raise exception 'Enter a quantity'; end if;
  if coalesce(p_mode, '') not in ('set', 'change') then raise exception 'Unknown mode: %', p_mode; end if;
  if coalesce(p_reason, '') not in ('count', 'damaged', 'expired', 'lost', 'own_use', 'found', 'opening', 'other') then
    raise exception 'Pick a reason';
  end if;

  select * into v_prod from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;
  if v_role <> 'admin' and v_prod.location_id <> public.get_user_location(v_user) then
    raise exception '% belongs to another store', v_prod.name;
  end if;

  v_before := coalesce(v_prod.stock_quantity, 0);
  v_after := case when p_mode = 'set' then p_quantity else v_before + p_quantity end;
  if v_after < 0 then
    raise exception 'Stock for % can''t go below 0 (now %)', v_prod.name, v_before;
  end if;
  if v_after = v_before then
    raise exception 'Stock for % is already %', v_prod.name, v_before;
  end if;

  perform set_config('dailykart.stock_src', 'adjustment|' || p_reason || '|' || v_prod.id::text, true);
  update public.products set stock_quantity = v_after, updated_at = now() where id = v_prod.id;

  insert into public.stock_adjustments (product_id, location_id, quantity_change, stock_before, stock_after,
                                        reason, note, created_by)
  values (v_prod.id, v_prod.location_id, v_after - v_before, v_before, v_after,
          p_reason, nullif(trim(coalesce(p_note, '')), ''), v_user)
  returning * into v_row;

  return v_row;
end;
$$;
revoke all on function public.adjust_stock(uuid, integer, text, text, text) from public, anon;
grant execute on function public.adjust_stock(uuid, integer, text, text, text) to authenticated;

-- Products whose stock doesn't match the ledger (should always be empty)
create or replace view public.stock_ledger_check
with (security_invoker = true) as
select p.id as product_id, p.name, p.location_id, coalesce(p.stock_quantity, 0) as stock_quantity,
       coalesce(sum(m.quantity_change), 0) as ledger_quantity
from public.products p
left join public.stock_movements m on m.product_id = p.id
group by p.id
having coalesce(p.stock_quantity, 0) <> coalesce(sum(m.quantity_change), 0);
grant select on public.stock_ledger_check to authenticated;

-- ---------------------------------------------------------------------
-- 2. Bill lines keep the product name and SKU as sold
-- ---------------------------------------------------------------------
alter table public.sale_items add column if not exists product_name text;
alter table public.sale_items add column if not exists sku text;

create or replace function public.snapshot_sale_item()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.product_name is null or new.sku is null then
    select coalesce(new.product_name, p.name), coalesce(new.sku, p.sku)
      into new.product_name, new.sku
    from public.products p where p.id = new.product_id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_snapshot_sale_item on public.sale_items;
create trigger trg_snapshot_sale_item before insert on public.sale_items
  for each row execute function public.snapshot_sale_item();

-- ---------------------------------------------------------------------
-- 3. MRP and price history
-- ---------------------------------------------------------------------
alter table public.products add column if not exists mrp numeric(10,2);

create table if not exists public.product_price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  old_price numeric(10,2), new_price numeric(10,2),
  old_cost numeric(10,2), new_cost numeric(10,2),
  old_mrp numeric(10,2), new_mrp numeric(10,2),
  old_gst numeric(5,2), new_gst numeric(5,2),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);
create index if not exists idx_price_history_product on public.product_price_history(product_id, changed_at desc);
alter table public.product_price_history enable row level security;
drop policy if exists "store read price history" on public.product_price_history;
create policy "store read price history" on public.product_price_history for select to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or (get_user_role(auth.uid()) <> 'cashier' and location_id = get_user_location(auth.uid())));
grant select on public.product_price_history to authenticated;

create or replace function public.log_price_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.price is distinct from old.price or new.cost_price is distinct from old.cost_price
     or new.mrp is distinct from old.mrp or new.gst_rate is distinct from old.gst_rate then
    insert into public.product_price_history (product_id, location_id, old_price, new_price, old_cost, new_cost,
                                              old_mrp, new_mrp, old_gst, new_gst)
    values (new.id, new.location_id, old.price, new.price, old.cost_price, new.cost_price,
            old.mrp, new.mrp, old.gst_rate, new.gst_rate);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_log_price_change on public.products;
create trigger trg_log_price_change after update of price, cost_price, mrp, gst_rate on public.products
  for each row execute function public.log_price_change();

-- ---------------------------------------------------------------------
-- 4. Saved bills can't be edited or deleted
-- A bill can still be filled in by the transaction that creates it.
-- ---------------------------------------------------------------------
create or replace function public.protect_saved_sale()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('dailykart.allow_bill_edit', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A saved bill can''t be deleted. Use a return to reverse it.';
  end if;
  if old.created_at = now() then return new; end if; -- created in this same transaction
  if new.customer_id is null and old.customer_id is not null
     and new.total_amount = old.total_amount and new.invoice_number = old.invoice_number then
    raise exception 'This customer has bills, so they can''t be deleted';
  end if;
  if new.invoice_number is distinct from old.invoice_number
     or new.total_amount is distinct from old.total_amount
     or new.tax_amount is distinct from old.tax_amount
     or new.discount_amount is distinct from old.discount_amount
     or new.payment_method is distinct from old.payment_method
     or new.customer_id is distinct from old.customer_id
     or new.cashier_id is distinct from old.cashier_id
     or new.location_id is distinct from old.location_id
     or new.created_at is distinct from old.created_at then
    raise exception 'A saved bill can''t be changed. Use a return or credit note.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_protect_saved_sale on public.sales;
create trigger trg_protect_saved_sale before update or delete on public.sales
  for each row execute function public.protect_saved_sale();

create or replace function public.protect_saved_sale_item()
returns trigger language plpgsql set search_path = public as $$
declare v_created timestamptz;
begin
  if coalesce(current_setting('dailykart.allow_bill_edit', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select created_at into v_created from public.sales where id = old.sale_id;
  if v_created = now() then return case when tg_op = 'DELETE' then old else new end; end if;
  raise exception 'Lines of a saved bill can''t be changed. Use a return.';
end;
$$;
drop trigger if exists trg_protect_saved_sale_item on public.sale_items;
create trigger trg_protect_saved_sale_item before update or delete on public.sale_items
  for each row execute function public.protect_saved_sale_item();

-- Fill the name snapshot on old bill lines (allowed once, here)
do $$ begin
  perform set_config('dailykart.allow_bill_edit', 'on', true);
  update public.sale_items si set product_name = p.name, sku = p.sku
  from public.products p
  where p.id = si.product_id and si.product_name is null;
  perform set_config('dailykart.allow_bill_edit', 'off', true);
end $$;

-- ---------------------------------------------------------------------
-- 5. No duplicate SKU / barcode within a store (only if none exist now)
-- ---------------------------------------------------------------------
create or replace view public.duplicate_product_codes
with (security_invoker = true) as
select location_id, 'sku' as kind, lower(sku) as code, count(*) as products, array_agg(name order by name) as names
from public.products where is_active is not false and coalesce(trim(sku), '') <> ''
group by location_id, lower(sku) having count(*) > 1
union all
select location_id, 'barcode', barcode, count(*), array_agg(name order by name)
from public.products where is_active is not false and coalesce(trim(barcode), '') <> ''
group by location_id, barcode having count(*) > 1;
grant select on public.duplicate_product_codes to authenticated;

do $$ begin
  if not exists (select 1 from public.products where is_active is not false and coalesce(trim(sku), '') <> ''
                 group by location_id, lower(sku) having count(*) > 1) then
    create unique index if not exists uq_products_store_sku on public.products(location_id, lower(sku))
      where is_active is not false and coalesce(trim(sku), '') <> '';
  end if;
  if not exists (select 1 from public.products where is_active is not false and coalesce(trim(barcode), '') <> ''
                 group by location_id, barcode having count(*) > 1) then
    create unique index if not exists uq_products_store_barcode on public.products(location_id, barcode)
      where is_active is not false and coalesce(trim(barcode), '') <> '';
  end if;
end $$;

notify pgrst, 'reload schema';
