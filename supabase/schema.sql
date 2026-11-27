-- =====================================================================
-- DailyKart: complete database setup (fresh Supabase project)
--
-- This one file builds the whole database from nothing:
--   Part A: base tables, roles, stores, security rules
--   Part B: the later updates (safe sales, GST bills, multiple stores)
--
-- Use it only on a NEW, EMPTY Supabase project (SQL Editor > paste > Run).
-- For the existing live database, run dailykart-updates.sql instead.
--
-- The old Lovable migrations are kept in supabase/legacy-migrations/ for
-- history only. They cannot rebuild the database; do not run them.
-- =====================================================================

-- ######################## Part A: base setup ########################
-- =====================================================================
-- DailyKart: full database setup for a NEW, EMPTY Supabase project
-- Run once in Supabase Dashboard > SQL Editor > New query > Run.
--
-- Rebuilt from the app's generated types (src/integrations/supabase/types.ts)
-- and the final state of supabase/migrations, with these fixes:
--   * creates the base tables the migrations folder never created
--   * leaves out the old migration that deleted non-admin data
--   * no hardcoded admin email (you promote yourself at the end)
--   * user_roles can only be changed by admins
--   * get_low_stock_products respects the caller's store (was leaking all stores)
--   * audit log can't be written directly by users
--   * new signups automatically get a profile, a cashier role and Default Store
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Locations
-- ---------------------------------------------------------------------
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  address text,
  created_at timestamptz not null default now()
);

insert into public.locations (name) values ('Default Store');

create or replace function public.default_location()
returns uuid language sql stable set search_path = public as $$
  select id from public.locations where name = 'Default Store' limit 1
$$;

-- ---------------------------------------------------------------------
-- 2. Users: profiles, roles, store assignments
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text,
  role text,
  created_at timestamptz default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'manager', 'cashier')),
  created_at timestamptz default now()
);

create table public.user_location_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.get_user_role(user_uuid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.user_roles where user_id = user_uuid), 'cashier')
$$;

create or replace function public.get_user_location(user_uuid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select location_id from public.user_location_assignments where user_id = user_uuid limit 1
$$;

-- New signup -> profile + cashier role + Default Store
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (user_id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'cashier')
  on conflict (user_id) do nothing;

  insert into public.user_location_assignments (user_id, location_id)
  values (new.id, public.default_location())
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 3. Business tables
-- ---------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text not null,
  barcode text,
  category text,
  price numeric(10,2) not null,
  cost_price numeric(10,2) not null,
  old_purchase_price numeric(10,2),
  new_purchase_price numeric(10,2),
  gst_rate numeric(5,2) default 0,
  stock_quantity integer default 0,
  min_stock_level integer default 0,
  base_unit text default 'pc',
  base_unit_quantity numeric(10,2) default 1,
  unit_variants jsonb default '[]'::jsonb,
  image_url text,
  is_active boolean default true,
  location_id uuid not null default public.default_location()
    references public.locations(id) on delete restrict,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_products_location on public.products(location_id);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  loyalty_points integer default 0,
  location_id uuid not null default public.default_location()
    references public.locations(id) on delete restrict,
  created_at timestamptz default now()
);
create index idx_customers_location on public.customers(location_id);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_person text,
  phone text,
  email text,
  address text,
  location_id uuid not null default public.default_location()
    references public.locations(id) on delete restrict,
  created_at timestamptz default now()
);
create index idx_suppliers_location on public.suppliers(location_id);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  amount numeric(10,2) not null,
  category text not null,
  description text,
  date date not null default current_date,
  created_by uuid not null references auth.users(id),
  location_id uuid not null default public.default_location()
    references public.locations(id) on delete restrict,
  created_at timestamptz default now()
);
create index idx_expenses_location on public.expenses(location_id);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  customer_id uuid references public.customers(id) on delete set null,
  cashier_id uuid not null references auth.users(id),
  total_amount numeric(10,2) not null,
  tax_amount numeric(10,2) default 0,
  discount_amount numeric(10,2) default 0,
  payment_method text default 'cash',
  status text default 'completed',
  location_id uuid not null default public.default_location()
    references public.locations(id) on delete restrict,
  created_at timestamptz default now()
);
create index idx_sales_location on public.sales(location_id);
create index idx_sales_created_at on public.sales(created_at);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric(10,3) not null,
  unit_price numeric(10,2) not null,
  total_price numeric(10,2) not null,
  gst_amount numeric(10,2) default 0
);
create index idx_sale_items_sale on public.sale_items(sale_id);

create table public.payment_settings (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null unique default public.default_location()
    references public.locations(id) on delete cascade,
  upi_vpa text not null,
  payee_name text,
  updated_by uuid not null,
  updated_at timestamptz not null default now()
);

create table public.security_audit_log (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  user_id uuid references auth.users(id),
  target_user_id uuid,
  details jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz default now()
);

-- New rows default to the creator's own store when the app doesn't send one
create or replace function public.set_location_from_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.location_id is null or new.location_id = public.default_location() then
    new.location_id := coalesce(public.get_user_location(auth.uid()), public.default_location());
  end if;
  return new;
end;
$$;

create trigger products_set_location  before insert on public.products  for each row execute function public.set_location_from_user();
create trigger customers_set_location before insert on public.customers for each row execute function public.set_location_from_user();
create trigger suppliers_set_location before insert on public.suppliers for each row execute function public.set_location_from_user();
create trigger expenses_set_location  before insert on public.expenses  for each row execute function public.set_location_from_user();
create trigger sales_set_location     before insert on public.sales     for each row execute function public.set_location_from_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 4. Helper / audit functions
-- ---------------------------------------------------------------------
create or replace function public.log_security_event(
  event_type text, target_user_id uuid default null, details jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.security_audit_log (event_type, user_id, target_user_id, details)
  values (event_type, auth.uid(), target_user_id, details);
end;
$$;

create or replace function public.audit_role_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform log_security_event('role_assigned', new.user_id, jsonb_build_object('new_role', new.role));
  elsif tg_op = 'UPDATE' then
    perform log_security_event('role_changed', new.user_id, jsonb_build_object('old_role', old.role, 'new_role', new.role));
  elsif tg_op = 'DELETE' then
    perform log_security_event('role_removed', old.user_id, jsonb_build_object('removed_role', old.role));
  end if;
  return coalesce(new, old);
end;
$$;
create trigger audit_user_role_changes
  after insert or update or delete on public.user_roles
  for each row execute function public.audit_role_changes();

-- Low stock: runs with the caller's permissions, so store rules apply
create or replace function public.get_low_stock_products()
returns setof public.products
language sql stable security invoker set search_path = public as $$
  select * from public.products
  where stock_quantity is not null
    and min_stock_level is not null
    and stock_quantity <= min_stock_level
    and is_active = true
$$;

-- ---------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------
alter table public.locations                 enable row level security;
alter table public.profiles                  enable row level security;
alter table public.user_roles                enable row level security;
alter table public.user_location_assignments enable row level security;
alter table public.products                  enable row level security;
alter table public.customers                 enable row level security;
alter table public.suppliers                 enable row level security;
alter table public.expenses                  enable row level security;
alter table public.sales                     enable row level security;
alter table public.sale_items                enable row level security;
alter table public.payment_settings          enable row level security;
alter table public.security_audit_log        enable row level security;

-- shorthand used below:  is_admin  = get_user_role(auth.uid()) = 'admin'
--                        my_store  = location_id = get_user_location(auth.uid())

-- locations
create policy "read locations" on public.locations for select to authenticated using (true);
create policy "admins manage locations" on public.locations for all to authenticated
  using (get_user_role(auth.uid()) = 'admin') with check (get_user_role(auth.uid()) = 'admin');

-- profiles
create policy "read own/store/admin profiles" on public.profiles for select to authenticated using (
  get_user_role(auth.uid()) = 'admin' or user_id = auth.uid()
  or exists (select 1 from user_location_assignments a, user_location_assignments b
             where a.user_id = auth.uid() and b.user_id = profiles.user_id and a.location_id = b.location_id));
create policy "update own profile" on public.profiles for update to authenticated
  using (user_id = auth.uid() or get_user_role(auth.uid()) = 'admin')
  with check (user_id = auth.uid() or get_user_role(auth.uid()) = 'admin');
create policy "admins insert profiles" on public.profiles for insert to authenticated
  with check (get_user_role(auth.uid()) = 'admin');
create policy "admins delete profiles" on public.profiles for delete to authenticated
  using (get_user_role(auth.uid()) = 'admin');

-- user_roles (only admins can change roles)
create policy "read own role" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or get_user_role(auth.uid()) = 'admin');
create policy "admins manage roles" on public.user_roles for all to authenticated
  using (get_user_role(auth.uid()) = 'admin') with check (get_user_role(auth.uid()) = 'admin');

-- user_location_assignments
create policy "read own assignment" on public.user_location_assignments for select to authenticated
  using (user_id = auth.uid() or get_user_role(auth.uid()) = 'admin');
create policy "admins manage assignments" on public.user_location_assignments for all to authenticated
  using (get_user_role(auth.uid()) = 'admin') with check (get_user_role(auth.uid()) = 'admin');

-- store-scoped tables: products, customers, suppliers, expenses, sales
do $$
declare t text;
begin
  foreach t in array array['products','customers','suppliers','expenses','sales'] loop
    execute format($f$
      create policy "store read %1$s" on public.%1$I for select to authenticated
        using (get_user_role(auth.uid()) = 'admin' or location_id = get_user_location(auth.uid()));
      create policy "store insert %1$s" on public.%1$I for insert to authenticated
        with check (get_user_role(auth.uid()) = 'admin' or location_id = get_user_location(auth.uid()));
      create policy "store update %1$s" on public.%1$I for update to authenticated
        using (get_user_role(auth.uid()) = 'admin' or location_id = get_user_location(auth.uid()))
        with check (get_user_role(auth.uid()) = 'admin' or location_id = get_user_location(auth.uid()));
      create policy "manager delete %1$s" on public.%1$I for delete to authenticated
        using (get_user_role(auth.uid()) = 'admin'
               or (get_user_role(auth.uid()) = 'manager' and location_id = get_user_location(auth.uid())));
    $f$, t);
  end loop;
end $$;

-- sale_items follow their sale
create policy "store read sale_items" on public.sale_items for select to authenticated using (
  get_user_role(auth.uid()) = 'admin'
  or exists (select 1 from sales s where s.id = sale_id and s.location_id = get_user_location(auth.uid())));
create policy "store insert sale_items" on public.sale_items for insert to authenticated with check (
  get_user_role(auth.uid()) = 'admin'
  or exists (select 1 from sales s where s.id = sale_id and s.location_id = get_user_location(auth.uid())));
create policy "store update sale_items" on public.sale_items for update to authenticated using (
  get_user_role(auth.uid()) = 'admin'
  or exists (select 1 from sales s where s.id = sale_id and s.location_id = get_user_location(auth.uid())));
create policy "admin delete sale_items" on public.sale_items for delete to authenticated
  using (get_user_role(auth.uid()) = 'admin');

-- payment_settings
create policy "admins manage payment settings" on public.payment_settings for all to authenticated
  using (get_user_role(auth.uid()) = 'admin') with check (get_user_role(auth.uid()) = 'admin');
create policy "store read payment settings" on public.payment_settings for select to authenticated
  using (get_user_role(auth.uid()) = 'admin' or location_id = get_user_location(auth.uid()));

-- audit log: admins read; writes only through the functions above
create policy "admins read audit log" on public.security_audit_log for select to authenticated
  using (get_user_role(auth.uid()) = 'admin');

-- ---------------------------------------------------------------------
-- 5b. Table access for signed-in users (RLS above still limits rows).
--     Newer Supabase projects don't grant this automatically.
-- ---------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
revoke execute on function public.log_security_event(text, uuid, jsonb) from authenticated, anon, public;


-- ####################### Part B: later updates #######################
-- =====================================================================
-- DailyKart: safe sale saving + proper invoice numbers
--
-- Safe to run more than once. Only ADDS things; no data is changed or
-- removed. Run it in Supabase > SQL Editor before (or after) deploying
-- the matching app code. The app keeps working either way: if this
-- function is missing it falls back to the old way of saving.
-- =====================================================================

-- Invoice prefix per store, e.g. DK -> DK/25-26/0001
alter table public.locations add column if not exists invoice_prefix text not null default 'DK';

-- One running counter per prefix and financial year (April to March).
-- Stores that share a prefix share one sequence, so numbers never clash.
create table if not exists public.invoice_counters (
  prefix text not null,
  financial_year text not null,
  last_number integer not null default 0,
  primary key (prefix, financial_year)
);
alter table public.invoice_counters enable row level security;
-- No policies on purpose: only create_sale() (security definer) touches it.
grant select, insert, update on public.invoice_counters to service_role;

-- ---------------------------------------------------------------------
-- create_sale: saves the bill, its items and the stock change in ONE
-- transaction. Either everything is saved or nothing is.
--   * locks each product row, so two counters cannot both sell the last piece
--   * refuses the sale if there is not enough stock
--   * works out prices, discount and GST on the server from the product
--   * gives the next invoice number, e.g. DK/25-26/0001
--
-- p_items: [{"product_id": "...", "quantity": 2, "discount": 10}, ...]
--          discount is a percent (0-100) on that line.
-- ---------------------------------------------------------------------
-- Remove any older version first, so there is only ever one create_sale
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
                            tax_amount, discount_amount, payment_method, location_id)
  values (v_invoice, p_customer_id, v_user, 0, 0, 0, p_payment_method, v_location)
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

    insert into public.sale_items (sale_id, product_id, quantity, unit_price, total_price, gst_amount)
    values (v_sale.id, v_prod.id, v_qty, v_prod.price, round(v_after + v_gst, 2), v_gst);

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

-- Ask the API to pick up the new function right away
notify pgrst, 'reload schema';

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

-- =====================================================================
-- DailyKart step 4: finish multiple stores
--
-- Run after the step 1 and step 3 updates (dailykart-updates.sql has all
-- of them in order). Safe to run more than once. No data is deleted.
-- =====================================================================

-- Mark the main store, so renaming "Default Store" can't break anything
alter table public.locations add column if not exists is_default boolean not null default false;
update public.locations set is_default = true
where name = 'Default Store' and not exists (select 1 from public.locations where is_default);
update public.locations set is_default = true
where id = (select id from public.locations order by created_at limit 1)
  and not exists (select 1 from public.locations where is_default);
create unique index if not exists locations_one_default on public.locations ((true)) where is_default;

create or replace function public.default_location()
returns uuid language sql stable set search_path = public as $$
  select id from public.locations
  order by is_default desc, (name = 'Default Store') desc, created_at
  limit 1
$$;

-- New records go to the right store:
--   staff  -> always their own store
--   admins -> the store the app sends (the store picker), else their own store
create or replace function public.set_location_from_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_home uuid;
begin
  if v_uid is null then
    -- SQL editor / service role
    new.location_id := coalesce(new.location_id, public.default_location());
    return new;
  end if;
  v_home := coalesce(public.get_user_location(v_uid), public.default_location());
  if public.get_user_role(v_uid) = 'admin' then
    new.location_id := coalesce(new.location_id, v_home);
  else
    new.location_id := v_home;
  end if;
  return new;
end;
$$;

-- Let the trigger choose the store instead of always "Default Store"
alter table public.products  alter column location_id drop default;
alter table public.customers alter column location_id drop default;
alter table public.suppliers alter column location_id drop default;
alter table public.expenses  alter column location_id drop default;
alter table public.sales     alter column location_id drop default;

-- Make sure every store-scoped table has the trigger
drop trigger if exists products_set_location  on public.products;
drop trigger if exists customers_set_location on public.customers;
drop trigger if exists suppliers_set_location on public.suppliers;
drop trigger if exists expenses_set_location  on public.expenses;
drop trigger if exists sales_set_location     on public.sales;
create trigger products_set_location  before insert on public.products  for each row execute function public.set_location_from_user();
create trigger customers_set_location before insert on public.customers for each row execute function public.set_location_from_user();
create trigger suppliers_set_location before insert on public.suppliers for each row execute function public.set_location_from_user();
create trigger expenses_set_location  before insert on public.expenses  for each row execute function public.set_location_from_user();
create trigger sales_set_location     before insert on public.sales     for each row execute function public.set_location_from_user();

-- create_sale: admins can bill for the store they picked; products and
-- customer must belong to that store, so stock stays correct per store
drop function if exists public.create_sale(jsonb, uuid, text);
drop function if exists public.create_sale(jsonb, uuid, text, uuid);

create or replace function public.create_sale(
  p_items jsonb,
  p_customer_id uuid default null,
  p_payment_method text default 'cash',
  p_location_id uuid default null
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
  -- Admins can bill for any store they pick; staff always bill for their own store
  if p_location_id is not null and v_is_admin then
    if not exists (select 1 from public.locations where id = p_location_id) then
      raise exception 'Store not found';
    end if;
    v_location := p_location_id;
  end if;

  if p_customer_id is not null and not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.location_id = v_location
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
    if v_prod.location_id <> v_location then
      raise exception '% belongs to another store. Switch store and try again.', v_prod.name;
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

revoke all on function public.create_sale(jsonb, uuid, text, uuid) from public, anon;
grant execute on function public.create_sale(jsonb, uuid, text, uuid) to authenticated;

-- Ask the API to pick up the changes right away
notify pgrst, 'reload schema';


-- =====================================================================
-- After running this file:
--  1. Supabase > Authentication > Sign In / Providers: turn OFF "Allow new users to sign up".
--  2. Supabase > Authentication > Users > Add user: create your own login.
--  3. Make that login an admin (replace the email, then run just this):
--
--     update public.user_roles set role = 'admin'
--     where user_id = (select id from auth.users where email = 'YOUR_EMAIL_HERE');
--
--  4. Deploy the admin-users Edge Function (supabase/functions/admin-users)
--     so admins can create staff logins from the app.
-- =====================================================================
