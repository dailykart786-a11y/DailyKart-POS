-- =====================================================================
-- DailyKart: more roles and a permissions screen
--   * new roles: inventory (stock / purchases) and accountant
--   * role_permissions: which role can use which part of the app. The
--     owner (admin) changes it on the Users page, no code change needed.
--   * returns, purchases and stock adjustments now check the permission
--     instead of a fixed role. Admin can always do everything.
--
-- Safe to run more than once. Only ADDS things; existing roles keep
-- exactly the access they had.
-- =====================================================================

alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
  check (role in ('admin', 'manager', 'cashier', 'inventory', 'accountant'));

create table if not exists public.role_permissions (
  role text not null check (role in ('manager', 'cashier', 'inventory', 'accountant')),
  permission text not null,
  primary key (role, permission)
);
alter table public.role_permissions enable row level security;
drop policy if exists "read role_permissions" on public.role_permissions;
create policy "read role_permissions" on public.role_permissions for select to authenticated using (true);
drop policy if exists "admin manage role_permissions" on public.role_permissions;
create policy "admin manage role_permissions" on public.role_permissions for all to authenticated
  using (get_user_role(auth.uid()) = 'admin') with check (get_user_role(auth.uid()) = 'admin');
grant select, insert, delete on public.role_permissions to authenticated;

-- Defaults (only added once; the owner's later changes are kept)
do $$ begin
  if not exists (select 1 from public.role_permissions) then
    insert into public.role_permissions (role, permission)
    select 'manager', unnest(array['sales','register','khata','returns','purchases','products','stock','customers','expenses','reports','offers','audit'])
    union all select 'cashier', unnest(array['sales','register','khata'])
    union all select 'inventory', unnest(array['products','stock','purchases'])
    union all select 'accountant', unnest(array['khata','expenses','reports','accounts','audit']);
  end if;
end $$;

create or replace function public.has_perm(p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.get_user_role(auth.uid()) = 'admin'
      or exists (select 1 from public.role_permissions rp
                 where rp.role = public.get_user_role(auth.uid()) and rp.permission = p_permission)
$$;
grant execute on function public.has_perm(text) to authenticated;

-- ---------------------------------------------------------------------
-- Functions: check the permission
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
  if not public.has_perm('returns') then
    raise exception 'Your role doesn''t allow returns';
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
  if not public.has_perm('purchases') then
    raise exception 'Your role doesn''t allow purchases';
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
  if not public.has_perm('stock') then
    raise exception 'Your role doesn''t allow stock changes';
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

revoke all on function public.create_return(uuid, jsonb, text, text) from public, anon;
grant execute on function public.create_return(uuid, jsonb, text, text) to authenticated;
revoke all on function public.create_purchase(uuid, jsonb, text, date, numeric, text, text) from public, anon;
grant execute on function public.create_purchase(uuid, jsonb, text, date, numeric, text, text) to authenticated;
revoke all on function public.adjust_stock(uuid, integer, text, text, text) from public, anon;
grant execute on function public.adjust_stock(uuid, integer, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Read / write rules that used to say "manager"
-- ---------------------------------------------------------------------
drop policy if exists "store read purchases" on public.purchases;
create policy "store read purchases" on public.purchases for select to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or ((has_perm('purchases') or has_perm('accounts')) and location_id = get_user_location(auth.uid())));
drop policy if exists "store read supplier_payments" on public.supplier_payments;
create policy "store read supplier_payments" on public.supplier_payments for select to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or ((has_perm('purchases') or has_perm('accounts')) and location_id = get_user_location(auth.uid())));
drop policy if exists "manager insert supplier_payments" on public.supplier_payments;
create policy "manager insert supplier_payments" on public.supplier_payments for insert to authenticated
  with check (get_user_role(auth.uid()) = 'admin'
              or ((has_perm('purchases') or has_perm('accounts')) and location_id = get_user_location(auth.uid())));

drop policy if exists "manager insert product_batches" on public.product_batches;
create policy "manager insert product_batches" on public.product_batches for insert to authenticated
  with check (get_user_role(auth.uid()) = 'admin'
              or (has_perm('stock') and location_id = get_user_location(auth.uid())));
drop policy if exists "manager update product_batches" on public.product_batches;
create policy "manager update product_batches" on public.product_batches for update to authenticated
  using (get_user_role(auth.uid()) = 'admin' or (has_perm('stock') and location_id = get_user_location(auth.uid())))
  with check (get_user_role(auth.uid()) = 'admin' or (has_perm('stock') and location_id = get_user_location(auth.uid())));

drop policy if exists "store read stock_adjustments" on public.stock_adjustments;
create policy "store read stock_adjustments" on public.stock_adjustments for select to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or ((has_perm('stock') or has_perm('reports')) and location_id = get_user_location(auth.uid())));
drop policy if exists "store read stock_movements" on public.stock_movements;
create policy "store read stock_movements" on public.stock_movements for select to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or ((has_perm('stock') or has_perm('reports')) and location_id = get_user_location(auth.uid())));
drop policy if exists "store read price history" on public.product_price_history;
create policy "store read price history" on public.product_price_history for select to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or ((has_perm('products') or has_perm('reports')) and location_id = get_user_location(auth.uid())));

drop policy if exists "manager write offers" on public.offers;
create policy "manager write offers" on public.offers for all to authenticated
  using (get_user_role(auth.uid()) = 'admin' or (has_perm('offers') and location_id = get_user_location(auth.uid())))
  with check (get_user_role(auth.uid()) = 'admin' or (has_perm('offers') and location_id = get_user_location(auth.uid())));

drop policy if exists "read audit_logs" on public.audit_logs;
create policy "read audit_logs" on public.audit_logs for select to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or (has_perm('audit') and location_id = get_user_location(auth.uid())));

notify pgrst, 'reload schema';
