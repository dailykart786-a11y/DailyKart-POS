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
-- DailyKart step 7: Udhaar / khata (customer credit)
--
-- Credit sales (payment method "credit") add to what a customer owes;
-- payments recorded here reduce it. Safe to run more than once.
-- =====================================================================

create table if not exists public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  amount numeric(10,2) not null check (amount > 0),
  method text not null default 'cash' check (method in ('cash', 'upi', 'card', 'bank')),
  note text,
  created_by uuid not null default auth.uid() references auth.users(id),
  location_id uuid references public.locations(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists idx_customer_payments_customer on public.customer_payments(customer_id);
create index if not exists idx_customer_payments_location on public.customer_payments(location_id);
create index if not exists idx_sales_customer on public.sales(customer_id);

alter table public.customer_payments enable row level security;

drop policy if exists "store read customer_payments" on public.customer_payments;
create policy "store read customer_payments" on public.customer_payments for select to authenticated
  using (get_user_role(auth.uid()) = 'admin' or location_id = get_user_location(auth.uid()));
drop policy if exists "store insert customer_payments" on public.customer_payments;
create policy "store insert customer_payments" on public.customer_payments for insert to authenticated
  with check (get_user_role(auth.uid()) = 'admin' or location_id = get_user_location(auth.uid()));
drop policy if exists "manager delete customer_payments" on public.customer_payments;
create policy "manager delete customer_payments" on public.customer_payments for delete to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or (get_user_role(auth.uid()) = 'manager' and location_id = get_user_location(auth.uid())));

grant select, insert, delete on public.customer_payments to authenticated;
grant all on public.customer_payments to service_role;

-- Payment goes to the customer's store
create or replace function public.set_payment_location()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select c.location_id into new.location_id from public.customers c where c.id = new.customer_id;
  if new.location_id is null then
    raise exception 'Customer not found';
  end if;
  return new;
end;
$$;
drop trigger if exists customer_payments_set_location on public.customer_payments;
create trigger customer_payments_set_location before insert on public.customer_payments
  for each row execute function public.set_payment_location();

-- A credit sale must name the customer who owes the money
create or replace function public.check_credit_sale()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.payment_method = 'credit' and new.customer_id is null then
    raise exception 'Credit (udhaar) sale needs a customer. Pick or add the customer first.';
  end if;
  return new;
end;
$$;
drop trigger if exists sales_check_credit on public.sales;
create trigger sales_check_credit before insert on public.sales
  for each row execute function public.check_credit_sale();

-- What each customer owes. Uses the viewer's own access rules.
drop view if exists public.customer_balances;
create view public.customer_balances with (security_invoker = true) as
select
  c.id as customer_id,
  c.name,
  c.phone,
  c.location_id,
  coalesce(cr.total, 0)::numeric(12,2) as credit_total,
  coalesce(pd.total, 0)::numeric(12,2) as paid_total,
  (coalesce(cr.total, 0) - coalesce(pd.total, 0))::numeric(12,2) as balance,
  greatest(cr.last_at, pd.last_at) as last_activity
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
) pd on pd.customer_id = c.id;

grant select on public.customer_balances to authenticated;

notify pgrst, 'reload schema';

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

-- =====================================================================
-- DailyKart steps 10 + 11: split payment and day closing (cash register)
-- Safe to run more than once.
-- =====================================================================

-- ---------- Split payment (part cash, part UPI, part card, part udhaar)
alter table public.sales add column if not exists payment_split jsonb;
alter table public.sales add column if not exists credit_amount numeric(10,2);

-- create_sale_split: same as create_sale, but the bill is paid in parts.
--   p_payments: {"cash": 300, "upi": 200, "card": 0, "credit": 0}
-- The parts must add up to the bill total, or nothing is saved.
create or replace function public.create_sale_split(
  p_items jsonb,
  p_payments jsonb,
  p_customer_id uuid default null,
  p_location_id uuid default null
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales;
  v_key text;
  v_val numeric;
  v_sum numeric := 0;
  v_clean jsonb := '{}'::jsonb;
  v_credit numeric := 0;
begin
  if p_payments is null or jsonb_typeof(p_payments) <> 'object' then
    raise exception 'Enter how much was paid each way';
  end if;
  for v_key, v_val in select key, value::text::numeric from jsonb_each(p_payments) loop
    if v_key not in ('cash', 'upi', 'card', 'credit') then
      raise exception 'Unknown payment method: %', v_key;
    end if;
    if v_val < 0 then raise exception 'Amounts can''t be negative'; end if;
    if v_val > 0 then
      v_clean := v_clean || jsonb_build_object(v_key, round(v_val, 2));
      v_sum := v_sum + round(v_val, 2);
    end if;
  end loop;
  v_credit := coalesce((v_clean->>'credit')::numeric, 0);
  if v_credit > 0 and p_customer_id is null then
    raise exception 'Udhaar (credit) part needs a customer. Pick or add the customer first.';
  end if;

  -- Save the bill exactly like a normal sale (stock, GST, invoice number)
  v_sale := public.create_sale(p_items, p_customer_id, 'cash', p_location_id);

  -- Allow a few paise of rounding difference: put it on the biggest part
  if abs(v_sum - v_sale.total_amount) > 0.009 and abs(v_sum - v_sale.total_amount) <= 0.05 then
    select key into v_key from jsonb_each_text(v_clean) order by value::numeric desc limit 1;
    v_clean := jsonb_set(v_clean, array[v_key], to_jsonb(round((v_clean->>v_key)::numeric + v_sale.total_amount - v_sum, 2)));
    v_credit := coalesce((v_clean->>'credit')::numeric, 0);
    v_sum := v_sale.total_amount;
  end if;
  if abs(v_sum - v_sale.total_amount) > 0.009 then
    raise exception 'Payments add up to % but the bill is %', v_sum, v_sale.total_amount;
  end if;

  update public.sales
  set payment_method = 'split', payment_split = v_clean, credit_amount = nullif(v_credit, 0)
  where id = v_sale.id
  returning * into v_sale;
  return v_sale;
end;
$$;
revoke all on function public.create_sale_split(jsonb, jsonb, uuid, uuid) from public, anon;
grant execute on function public.create_sale_split(jsonb, jsonb, uuid, uuid) to authenticated;

-- Khata counts the udhaar part of split bills too
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
  select customer_id,
         sum(coalesce(credit_amount, case when payment_method = 'credit' then total_amount else 0 end)) as total,
         max(created_at) as last_at
  from public.sales
  where (payment_method = 'credit' or credit_amount > 0) and coalesce(status, 'completed') <> 'cancelled'
  group by customer_id
) cr on cr.customer_id = c.id
left join (
  select customer_id, sum(amount) as total, max(created_at) as last_at
  from public.customer_payments group by customer_id
) pd on pd.customer_id = c.id
left join (
  select customer_id, sum(refund_amount) as total, max(created_at) as last_at
  from public.sale_returns where refund_method = 'khata' group by customer_id
) rt on rt.customer_id = c.id;
grant select on public.customer_balances to authenticated;

-- ---------- Day closing: one register session per person per store
create table if not exists public.register_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  location_id uuid not null references public.locations(id) on delete restrict,
  opened_at timestamptz not null default now(),
  opening_cash numeric(12,2) not null default 0,
  closed_at timestamptz,
  counted_cash numeric(12,2),
  expected_cash numeric(12,2),
  difference numeric(12,2),
  totals jsonb,
  note text
);
create index if not exists idx_register_sessions_user on public.register_sessions(user_id, closed_at);
create index if not exists idx_register_sessions_location on public.register_sessions(location_id, opened_at);
create unique index if not exists register_one_open_per_user on public.register_sessions(user_id) where closed_at is null;

alter table public.register_sessions enable row level security;
drop policy if exists "read own or store registers" on public.register_sessions;
create policy "read own or store registers" on public.register_sessions for select to authenticated
  using (user_id = auth.uid()
         or get_user_role(auth.uid()) = 'admin'
         or (get_user_role(auth.uid()) = 'manager' and location_id = get_user_location(auth.uid())));
grant select on public.register_sessions to authenticated;
grant all on public.register_sessions to service_role;

-- Money taken by one person between two times
create or replace function public.register_totals(p_user uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select payment_method, total_amount, payment_split
    from public.sales
    where cashier_id = p_user and created_at >= p_from and created_at <= p_to
      and coalesce(status, 'completed') <> 'cancelled'
  ),
  by_method as (
    select
      coalesce(sum(case when payment_method = 'cash' then total_amount else coalesce((payment_split->>'cash')::numeric, 0) end), 0) as cash,
      coalesce(sum(case when payment_method = 'upi' then total_amount else coalesce((payment_split->>'upi')::numeric, 0) end), 0) as upi,
      coalesce(sum(case when payment_method = 'card' then total_amount else coalesce((payment_split->>'card')::numeric, 0) end), 0) as card,
      coalesce(sum(case when payment_method = 'credit' then total_amount else coalesce((payment_split->>'credit')::numeric, 0) end), 0) as credit,
      count(*) as bills,
      coalesce(sum(total_amount), 0) as total
    from s
  )
  select jsonb_build_object(
    'bills', b.bills,
    'total_sales', b.total,
    'cash_sales', b.cash,
    'upi_sales', b.upi,
    'card_sales', b.card,
    'credit_sales', b.credit,
    'khata_cash_received', (select coalesce(sum(amount), 0) from public.customer_payments
                            where created_by = p_user and method = 'cash' and created_at >= p_from and created_at <= p_to),
    'khata_upi_received', (select coalesce(sum(amount), 0) from public.customer_payments
                           where created_by = p_user and method = 'upi' and created_at >= p_from and created_at <= p_to),
    'cash_refunds', (select coalesce(sum(refund_amount), 0) from public.sale_returns
                     where created_by = p_user and refund_method = 'cash' and created_at >= p_from and created_at <= p_to),
    'supplier_cash_paid', (select coalesce(sum(amount), 0) from public.supplier_payments
                           where created_by = p_user and method = 'cash' and created_at >= p_from and created_at <= p_to)
  )
  from by_method b
$$;
revoke all on function public.register_totals(uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.open_register(p_opening_cash numeric default 0)
returns public.register_sessions
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_row public.register_sessions;
begin
  if v_user is null then raise exception 'Please sign in again'; end if;
  if coalesce(p_opening_cash, 0) < 0 then raise exception 'Opening cash can''t be negative'; end if;
  select * into v_row from public.register_sessions where user_id = v_user and closed_at is null;
  if found then return v_row; end if;
  insert into public.register_sessions (user_id, location_id, opening_cash)
  values (v_user, coalesce(public.get_user_location(v_user), public.default_location()), round(coalesce(p_opening_cash, 0), 2))
  returning * into v_row;
  return v_row;
end;
$$;

-- What the drawer should have right now (for the open session)
create or replace function public.register_status()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_row public.register_sessions;
  v_t jsonb;
begin
  select * into v_row from public.register_sessions where user_id = auth.uid() and closed_at is null;
  if not found then return null; end if;
  v_t := public.register_totals(auth.uid(), v_row.opened_at, now());
  return jsonb_build_object(
    'session', to_jsonb(v_row),
    'totals', v_t,
    'expected_cash', v_row.opening_cash + (v_t->>'cash_sales')::numeric + (v_t->>'khata_cash_received')::numeric
                     - (v_t->>'cash_refunds')::numeric - (v_t->>'supplier_cash_paid')::numeric
  );
end;
$$;

create or replace function public.close_register(p_counted_cash numeric, p_note text default null)
returns public.register_sessions
language plpgsql security definer set search_path = public as $$
declare
  v_row public.register_sessions;
  v_t jsonb;
  v_expected numeric;
begin
  select * into v_row from public.register_sessions where user_id = auth.uid() and closed_at is null for update;
  if not found then raise exception 'No open register to close'; end if;
  if p_counted_cash is null or p_counted_cash < 0 then raise exception 'Enter the cash counted in the drawer'; end if;
  v_t := public.register_totals(auth.uid(), v_row.opened_at, now());
  v_expected := v_row.opening_cash + (v_t->>'cash_sales')::numeric + (v_t->>'khata_cash_received')::numeric
                - (v_t->>'cash_refunds')::numeric - (v_t->>'supplier_cash_paid')::numeric;
  update public.register_sessions
  set closed_at = now(), counted_cash = round(p_counted_cash, 2), expected_cash = round(v_expected, 2),
      difference = round(p_counted_cash - v_expected, 2), totals = v_t,
      note = nullif(trim(coalesce(p_note, '')), '')
  where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.open_register(numeric) from public, anon;
revoke all on function public.register_status() from public, anon;
revoke all on function public.close_register(numeric, text) from public, anon;
grant execute on function public.open_register(numeric) to authenticated;
grant execute on function public.register_status() to authenticated;
grant execute on function public.close_register(numeric, text) to authenticated;

notify pgrst, 'reload schema';

-- =====================================================================
-- DailyKart: stock control (stock adjustments with a reason)
--
-- Safe to run more than once. Only ADDS things. The app keeps working
-- without it: the reorder list works anyway, and the "Adjust stock" part
-- asks for this update.
-- =====================================================================

create table if not exists public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  quantity_change integer not null,
  stock_before integer not null,
  stock_after integer not null,
  reason text not null check (reason in ('count', 'damaged', 'expired', 'lost', 'own_use', 'found', 'opening', 'other')),
  note text,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_adjustments_location on public.stock_adjustments(location_id, created_at desc);
create index if not exists idx_stock_adjustments_product on public.stock_adjustments(product_id, created_at desc);

alter table public.stock_adjustments enable row level security;
-- Read only. Rows are written by adjust_stock() below, never directly.
drop policy if exists "store read stock_adjustments" on public.stock_adjustments;
create policy "store read stock_adjustments" on public.stock_adjustments for select to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or (get_user_role(auth.uid()) = 'manager' and location_id = get_user_location(auth.uid())));
grant select on public.stock_adjustments to authenticated;

-- ---------------------------------------------------------------------
-- adjust_stock: change one product's stock and record why, in one go.
--   p_mode 'set'    -> p_quantity is the counted stock (stock count)
--   p_mode 'change' -> p_quantity is added (negative removes)
-- Manager (own store) or admin only. Locks the product row so a sale
-- happening at the same moment is not lost.
-- ---------------------------------------------------------------------
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

notify pgrst, 'reload schema';

-- =====================================================================
-- DailyKart: offline billing sync
--
-- When the internet is down, the till keeps billing and saves the bills
-- on the device. When the internet is back, each bill is sent here.
-- Every offline bill carries its own id (client_ref), so a bill can be
-- sent twice without being saved twice.
--
-- Safe to run more than once. Only ADDS things.
-- =====================================================================

alter table public.sales add column if not exists client_ref uuid;
alter table public.sales add column if not exists offline_sold_at timestamptz;
create unique index if not exists idx_sales_client_ref on public.sales(client_ref) where client_ref is not null;

create or replace function public.sync_offline_sale(
  p_client_ref uuid,
  p_items jsonb,
  p_sold_at timestamptz,
  p_customer_id uuid default null,
  p_payment_method text default 'cash',
  p_payments jsonb default null,
  p_location_id uuid default null,
  p_expected_total numeric default null,
  p_uncertain boolean default false
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_sale public.sales;
  v_sold timestamptz;
begin
  if v_user is null then raise exception 'Please sign in again'; end if;
  if p_client_ref is null then raise exception 'Missing bill id'; end if;

  -- Only one sync of the same bill at a time
  perform pg_advisory_xact_lock(hashtext('offline_sale:' || p_client_ref::text));

  -- Already saved? Return it, don't save it again.
  select * into v_sale from public.sales where client_ref = p_client_ref;
  if found then return v_sale; end if;

  -- Keep the time it was really sold, within reason
  v_sold := least(greatest(coalesce(p_sold_at, now()), now() - interval '30 days'), now());

  -- The till lost the connection while saving: the bill may have reached
  -- us already. Match it to a bill by the same cashier, same amount,
  -- saved within a few minutes, that has no offline id yet.
  if p_uncertain and p_expected_total is not null then
    select * into v_sale from public.sales s
    where s.cashier_id = v_user
      and s.client_ref is null
      and abs(s.total_amount - p_expected_total) <= 1
      and s.created_at between v_sold - interval '2 minutes' and v_sold + interval '10 minutes'
      and (select count(*) from public.sale_items si where si.sale_id = s.id)
          = (select count(distinct e->>'product_id') from jsonb_array_elements(p_items) e)
    order by s.created_at
    limit 1
    for update;
    if found then
      update public.sales set client_ref = p_client_ref where id = v_sale.id returning * into v_sale;
      return v_sale;
    end if;
  end if;

  if p_payments is not null and jsonb_typeof(p_payments) = 'object' and p_payment_method = 'split' then
    v_sale := public.create_sale_split(p_items, p_payments, p_customer_id, p_location_id);
  else
    v_sale := public.create_sale(p_items, p_customer_id, p_payment_method, p_location_id);
  end if;

  update public.sales
  set client_ref = p_client_ref,
      offline_sold_at = v_sold,
      created_at = v_sold
  where id = v_sale.id
  returning * into v_sale;

  return v_sale;
end;
$$;

revoke all on function public.sync_offline_sale(uuid, jsonb, timestamptz, uuid, text, jsonb, uuid, numeric, boolean) from public, anon;
grant execute on function public.sync_offline_sale(uuid, jsonb, timestamptz, uuid, text, jsonb, uuid, numeric, boolean) to authenticated;

notify pgrst, 'reload schema';

-- =====================================================================
-- DailyKart: batch numbers and expiry dates
--
-- A batch is recorded when stock comes in (purchase entry or Stock page).
-- Sales don't need to pick a batch: the app assumes the oldest stock is
-- sold first and works out what is probably left of each batch.
--
-- Safe to run more than once. Only ADDS things.
-- =====================================================================

create table if not exists public.product_batches (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  batch_no text,
  expiry_date date,
  quantity integer not null check (quantity > 0),
  purchase_id uuid references public.purchases(id) on delete set null,
  cleared_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (batch_no is not null or expiry_date is not null)
);
create index if not exists idx_product_batches_product on public.product_batches(product_id, created_at desc);
create index if not exists idx_product_batches_expiry on public.product_batches(location_id, expiry_date) where cleared_at is null;

alter table public.product_batches enable row level security;

-- Everyone in the store can see expiry dates (cashiers check them at the counter)
drop policy if exists "store read product_batches" on public.product_batches;
create policy "store read product_batches" on public.product_batches for select to authenticated
  using (get_user_role(auth.uid()) = 'admin' or location_id = get_user_location(auth.uid()));

drop policy if exists "manager insert product_batches" on public.product_batches;
create policy "manager insert product_batches" on public.product_batches for insert to authenticated
  with check (get_user_role(auth.uid()) = 'admin'
              or (get_user_role(auth.uid()) = 'manager' and location_id = get_user_location(auth.uid())));

drop policy if exists "manager update product_batches" on public.product_batches;
create policy "manager update product_batches" on public.product_batches for update to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or (get_user_role(auth.uid()) = 'manager' and location_id = get_user_location(auth.uid())))
  with check (get_user_role(auth.uid()) = 'admin'
              or (get_user_role(auth.uid()) = 'manager' and location_id = get_user_location(auth.uid())));

grant select, insert, update on public.product_batches to authenticated;

-- The batch always belongs to the product's store
create or replace function public.set_batch_location()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select p.location_id into new.location_id from public.products p where p.id = new.product_id;
  if new.location_id is null then raise exception 'Product not found'; end if;
  return new;
end;
$$;
drop trigger if exists trg_set_batch_location on public.product_batches;
create trigger trg_set_batch_location before insert on public.product_batches
  for each row execute function public.set_batch_location();

notify pgrst, 'reload schema';

-- =====================================================================
-- DailyKart: offers (automatic discounts) and loyalty points
--
-- Loyalty is OFF until a manager turns it on for their store.
-- Points are worked out from what customers buy (less returns) after the
-- store's loyalty start date, minus points already used. No sale code
-- changes: used points are given as a discount on the bill.
--
-- Safe to run more than once. Only ADDS things.
-- =====================================================================

-- Per-store loyalty settings
alter table public.locations add column if not exists loyalty_enabled boolean not null default false;
alter table public.locations add column if not exists loyalty_earn_per_100 numeric(6,2) not null default 1;  -- points per ₹100
alter table public.locations add column if not exists loyalty_point_value numeric(6,2) not null default 1;   -- ₹ per point
alter table public.locations add column if not exists loyalty_min_redeem integer not null default 50;
alter table public.locations add column if not exists loyalty_since timestamptz not null default now();

-- ---------------------------------------------------------------------
-- Offers: a % off on a product, a category or everything, between dates
-- ---------------------------------------------------------------------
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null default public.default_location() references public.locations(id) on delete cascade,
  name text not null,
  percent numeric(5,2) not null check (percent > 0 and percent <= 90),
  product_id uuid references public.products(id) on delete cascade,
  category text,
  min_qty integer not null default 1 check (min_qty >= 1),
  starts_on date,
  ends_on date,
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index if not exists idx_offers_location on public.offers(location_id) where is_active;
alter table public.offers enable row level security;

drop policy if exists "store read offers" on public.offers;
create policy "store read offers" on public.offers for select to authenticated
  using (get_user_role(auth.uid()) = 'admin' or location_id = get_user_location(auth.uid()));
drop policy if exists "manager write offers" on public.offers;
create policy "manager write offers" on public.offers for all to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or (get_user_role(auth.uid()) = 'manager' and location_id = get_user_location(auth.uid())))
  with check (get_user_role(auth.uid()) = 'admin'
              or (get_user_role(auth.uid()) = 'manager' and location_id = get_user_location(auth.uid())));
grant select, insert, update, delete on public.offers to authenticated;

drop trigger if exists trg_set_location_offers on public.offers;
create trigger trg_set_location_offers before insert on public.offers
  for each row execute function public.set_location_from_user();

-- ---------------------------------------------------------------------
-- Loyalty: points used (redeemed) on bills
-- ---------------------------------------------------------------------
create table if not exists public.loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  sale_id uuid references public.sales(id) on delete set null,
  points integer not null check (points > 0),
  value numeric(10,2) not null check (value >= 0),
  location_id uuid not null references public.locations(id) on delete restrict,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_loyalty_redemptions_customer on public.loyalty_redemptions(customer_id);
create unique index if not exists idx_loyalty_redemptions_sale on public.loyalty_redemptions(sale_id) where sale_id is not null;
alter table public.loyalty_redemptions enable row level security;
drop policy if exists "store read loyalty_redemptions" on public.loyalty_redemptions;
create policy "store read loyalty_redemptions" on public.loyalty_redemptions for select to authenticated
  using (get_user_role(auth.uid()) = 'admin' or location_id = get_user_location(auth.uid()));
grant select on public.loyalty_redemptions to authenticated;

-- Points per customer (follows the caller's access to customers and sales)
create or replace view public.customer_loyalty
with (security_invoker = true) as
select
  c.id as customer_id,
  c.location_id,
  coalesce(s.spent, 0) - coalesce(r.returned, 0) as eligible_spend,
  greatest(0, floor((coalesce(s.spent, 0) - coalesce(r.returned, 0)) * l.loyalty_earn_per_100 / 100))::int
    + coalesce(c.loyalty_points, 0) as earned,
  coalesce(u.used, 0) as used,
  greatest(0, floor((coalesce(s.spent, 0) - coalesce(r.returned, 0)) * l.loyalty_earn_per_100 / 100))::int
    + coalesce(c.loyalty_points, 0) - coalesce(u.used, 0) as balance,
  l.loyalty_enabled,
  l.loyalty_point_value,
  l.loyalty_min_redeem
from public.customers c
join public.locations l on l.id = c.location_id
left join lateral (
  select sum(x.total_amount) as spent from public.sales x
  where x.customer_id = c.id and x.created_at >= l.loyalty_since
) s on true
left join lateral (
  select sum(sr.refund_amount) as returned from public.sale_returns sr
  where sr.customer_id = c.id and sr.created_at >= l.loyalty_since
) r on true
left join lateral (
  select sum(lr.points) as used from public.loyalty_redemptions lr where lr.customer_id = c.id
) u on true;
grant select on public.customer_loyalty to authenticated;

-- Records points used on a bill. Checks the balance, and that the bill is
-- this customer's, made by this cashier in the last 30 minutes.
create or replace function public.redeem_loyalty_points(p_sale_id uuid, p_points integer, p_value numeric)
returns public.loyalty_redemptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_sale public.sales;
  v_loc public.locations;
  v_balance int;
  v_row public.loyalty_redemptions;
begin
  if v_user is null then raise exception 'Please sign in again'; end if;
  if coalesce(p_points, 0) <= 0 then raise exception 'Enter the points to use'; end if;

  select * into v_sale from public.sales where id = p_sale_id;
  if not found or v_sale.customer_id is null then raise exception 'Bill not found or has no customer'; end if;
  if v_sale.cashier_id <> v_user and public.get_user_role(v_user) not in ('admin', 'manager') then
    raise exception 'Only the cashier of this bill can use points on it';
  end if;
  if v_sale.created_at < now() - interval '30 minutes' then raise exception 'Points can only be used on a new bill'; end if;

  select * into v_loc from public.locations where id = (select location_id from public.customers where id = v_sale.customer_id);
  if not coalesce(v_loc.loyalty_enabled, false) then raise exception 'Loyalty points are off for this store'; end if;

  -- One customer at a time, so two counters can't spend the same points
  perform pg_advisory_xact_lock(hashtext('loyalty:' || v_sale.customer_id::text));

  -- Points from before this bill (this bill's own points can't pay for it)
  select balance into v_balance from public.customer_loyalty where customer_id = v_sale.customer_id;
  if v_sale.created_at >= v_loc.loyalty_since then
    v_balance := v_balance - floor(coalesce(v_sale.total_amount, 0) * v_loc.loyalty_earn_per_100 / 100)::int;
  end if;
  if coalesce(v_balance, 0) < p_points then
    raise exception 'Only % points available', coalesce(v_balance, 0);
  end if;

  if exists (select 1 from public.loyalty_redemptions where sale_id = v_sale.id) then
    raise exception 'Points were already used on this bill';
  end if;

  insert into public.loyalty_redemptions (customer_id, sale_id, points, value, location_id, created_by)
  values (v_sale.customer_id, v_sale.id, p_points, greatest(0, round(coalesce(p_value, 0), 2)), v_sale.location_id, v_user)
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.redeem_loyalty_points(uuid, integer, numeric) from public, anon;
grant execute on function public.redeem_loyalty_points(uuid, integer, numeric) to authenticated;

notify pgrst, 'reload schema';

-- =====================================================================
-- DailyKart: WhatsApp number for the daily summary
--
-- Safe to run more than once. Only ADDS things.
-- =====================================================================

-- The owner's WhatsApp number the end-of-day summary is sent to
alter table public.locations add column if not exists summary_whatsapp text;

notify pgrst, 'reload schema';

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

-- =====================================================================
-- DailyKart: activity / audit log
-- Who did what, when: bills, returns, payments, purchases, stock,
-- products, customers, expenses, users, settings.
-- Rows are written only by triggers and can't be edited or deleted.
--
-- Safe to run more than once. Only ADDS things.
-- =====================================================================

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  location_id uuid,
  table_name text not null,
  record_id text,
  action text not null check (action in ('insert', 'update', 'delete')),
  changes jsonb,          -- new row (insert), changed fields old/new (update), old row (delete)
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);
create index if not exists idx_audit_logs_time on public.audit_logs(changed_at desc);
create index if not exists idx_audit_logs_location on public.audit_logs(location_id, changed_at desc);
create index if not exists idx_audit_logs_record on public.audit_logs(table_name, record_id);

alter table public.audit_logs enable row level security;
drop policy if exists "read audit_logs" on public.audit_logs;
create policy "read audit_logs" on public.audit_logs for select to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or (get_user_role(auth.uid()) = 'manager' and location_id = get_user_location(auth.uid())));
grant select on public.audit_logs to authenticated;

create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb;
  k text;
begin
  if tg_op = 'UPDATE' then
    v_changes := '{}'::jsonb;
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at') and (v_new -> k) is distinct from (v_old -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('old', v_old -> k, 'new', v_new -> k));
      end if;
    end loop;
    -- a bill being filled in by the transaction that created it: logged once at commit
    if tg_table_name = 'sales' and (v_old ->> 'created_at')::timestamptz = now() then
      return null;
    end if;
    -- stock-only changes are already in the stock ledger
    if v_changes = '{}'::jsonb or (tg_table_name = 'products' and v_changes - 'stock_quantity' = '{}'::jsonb) then
      return null;
    end if;
  else
    v_changes := v_row;
  end if;
  insert into public.audit_logs (location_id, table_name, record_id, action, changes)
  values (
    case when v_row ? 'location_id' then nullif(v_row ->> 'location_id', '')::uuid
         when tg_table_name = 'locations' then (v_row ->> 'id')::uuid end,
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id'),
    lower(tg_op),
    v_changes
  );
  return null;
end;
$$;

-- Bills: logged at commit, with their final totals
create or replace function public.audit_sale_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  select to_jsonb(s) into v from public.sales s where s.id = new.id;
  if v is null then return null; end if;
  insert into public.audit_logs (location_id, table_name, record_id, action, changes, changed_by)
  values ((v ->> 'location_id')::uuid, 'sales', v ->> 'id', 'insert', v, auth.uid());
  return null;
end;
$$;
drop trigger if exists trg_audit_sale_insert on public.sales;
create constraint trigger trg_audit_sale_insert after insert on public.sales
  deferrable initially deferred for each row execute function public.audit_sale_insert();

do $$
declare t text;
begin
  foreach t in array array[
    'sale_returns', 'customer_payments', 'supplier_payments', 'purchases', 'stock_adjustments',
    'products', 'customers', 'suppliers', 'expenses', 'user_roles', 'user_location_assignments', 'locations',
    'offers', 'register_sessions', 'loyalty_redemptions', 'product_batches', 'payment_settings'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_audit on public.%I', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
    end if;
  end loop;
  -- bills: only changes after saving and deletes (the insert is logged at commit above)
  if to_regclass('public.sales') is not null then
    execute 'drop trigger if exists trg_audit on public.sales';
    execute 'create trigger trg_audit after update or delete on public.sales for each row execute function public.audit_row()';
  end if;
end $$;

notify pgrst, 'reload schema';

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

-- =====================================================================
-- DailyKart: khata upgrade (credit limits, due days, customer groups,
-- opening balances, payment reversal, supplier credit terms)
--
-- Only adds things. Customers and suppliers with no limit or terms set
-- behave exactly as before. Safe to run more than once.
-- =====================================================================

-- ---------- New fields
alter table public.customers add column if not exists opening_balance numeric(12,2) not null default 0;
alter table public.customers add column if not exists credit_limit numeric(12,2);
alter table public.customers add column if not exists credit_days integer;
alter table public.customers add column if not exists customer_group text;
do $$ begin
  alter table public.customers add constraint customers_credit_limit_ok check (credit_limit is null or credit_limit >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.customers add constraint customers_credit_days_ok check (credit_days is null or credit_days between 0 and 365);
exception when duplicate_object then null; end $$;
create index if not exists idx_customers_group on public.customers(customer_group) where customer_group is not null;

alter table public.suppliers add column if not exists opening_balance numeric(12,2) not null default 0;
alter table public.suppliers add column if not exists credit_days integer;
alter table public.suppliers add column if not exists credit_limit numeric(12,2);
do $$ begin
  alter table public.suppliers add constraint suppliers_credit_days_ok check (credit_days is null or credit_days between 0 and 365);
exception when duplicate_object then null; end $$;

-- A wrong payment is reversed, not deleted: the row stays with who reversed it and why
alter table public.customer_payments add column if not exists reversed_at timestamptz;
alter table public.customer_payments add column if not exists reversed_by uuid references auth.users(id);
alter table public.customer_payments add column if not exists reversal_reason text;
alter table public.supplier_payments add column if not exists reversed_at timestamptz;
alter table public.supplier_payments add column if not exists reversed_by uuid references auth.users(id);
alter table public.supplier_payments add column if not exists reversal_reason text;

-- Only managers, admins and accountants may set limits, terms and opening balances
create or replace function public.protect_credit_terms()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.get_user_role(auth.uid()) in ('admin', 'manager', 'accountant') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if coalesce(new.opening_balance, 0) <> 0 or new.credit_limit is not null or new.credit_days is not null then
      raise exception 'Only a manager can set opening balance, credit limit or credit days';
    end if;
  elsif new.opening_balance is distinct from old.opening_balance
     or new.credit_limit is distinct from old.credit_limit
     or new.credit_days is distinct from old.credit_days then
    raise exception 'Only a manager can change opening balance, credit limit or credit days';
  end if;
  return new;
end;
$$;
drop trigger if exists customers_protect_credit on public.customers;
create trigger customers_protect_credit before insert or update on public.customers
  for each row execute function public.protect_credit_terms();
drop trigger if exists suppliers_protect_credit on public.suppliers;
create trigger suppliers_protect_credit before insert or update on public.suppliers
  for each row execute function public.protect_credit_terms();

-- ---------- What a customer owes right now (opening + udhaar - payments - khata refunds)
create or replace function public.customer_due(p_customer_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select (
    coalesce((select opening_balance from public.customers where id = p_customer_id), 0)
    + coalesce((select sum(coalesce(credit_amount, case when payment_method = 'credit' then total_amount else 0 end))
                from public.sales
                where customer_id = p_customer_id
                  and (payment_method = 'credit' or credit_amount > 0)
                  and coalesce(status, 'completed') <> 'cancelled'), 0)
    - coalesce((select sum(amount) from public.customer_payments
                where customer_id = p_customer_id and reversed_at is null), 0)
    - coalesce((select sum(refund_amount) from public.sale_returns
                where customer_id = p_customer_id and refund_method = 'khata'), 0)
  )::numeric(12,2)
$$;
grant execute on function public.customer_due(uuid) to authenticated;

-- ---------- Credit limit: checked when the bill is final (at commit).
-- Managers and admins may go over it. Bills made offline are never
-- blocked, because the goods have already gone.
create or replace function public.check_credit_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_sale public.sales;
  v_limit numeric;
  v_name text;
  v_due numeric;
begin
  select * into v_sale from public.sales where id = new.id;
  if v_sale.id is null or v_sale.customer_id is null or v_sale.client_ref is not null then return null; end if;
  if coalesce(v_sale.credit_amount, case when v_sale.payment_method = 'credit' then v_sale.total_amount else 0 end) <= 0 then
    return null;
  end if;
  select credit_limit, name into v_limit, v_name from public.customers where id = v_sale.customer_id;
  if v_limit is null then return null; end if;
  if public.get_user_role(auth.uid()) in ('admin', 'manager') then return null; end if;
  v_due := public.customer_due(v_sale.customer_id);
  if v_due > v_limit + 0.005 then
    raise exception 'Udhaar limit crossed for %: limit Rs %, due after this bill Rs %. Ask the manager to bill it, or take part payment.',
      v_name, to_char(v_limit, 'FM999999990.00'), to_char(v_due, 'FM999999990.00');
  end if;
  return null;
end;
$$;
drop trigger if exists trg_check_credit_limit on public.sales;
create constraint trigger trg_check_credit_limit after insert on public.sales
  deferrable initially deferred for each row execute function public.check_credit_limit();

-- ---------- Reverse a wrong payment (managers, admins, accountants)
create or replace function public.reverse_customer_payment(p_payment_id uuid, p_reason text)
returns public.customer_payments
language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.get_user_role(auth.uid());
  v_row public.customer_payments;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Write why the payment is being reversed'; end if;
  select * into v_row from public.customer_payments where id = p_payment_id for update;
  if v_row.id is null then raise exception 'Payment not found'; end if;
  if v_role <> 'admin' and (v_role not in ('manager', 'accountant') or not public.has_perm('khata')
                            or v_row.location_id is distinct from public.get_user_location(auth.uid())) then
    raise exception 'Only a manager or accountant can reverse a payment';
  end if;
  if v_row.reversed_at is not null then raise exception 'This payment was already reversed'; end if;
  update public.customer_payments
     set reversed_at = now(), reversed_by = auth.uid(), reversal_reason = trim(p_reason)
   where id = p_payment_id
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.reverse_customer_payment(uuid, text) to authenticated;

create or replace function public.reverse_supplier_payment(p_payment_id uuid, p_reason text)
returns public.supplier_payments
language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.get_user_role(auth.uid());
  v_row public.supplier_payments;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Write why the payment is being reversed'; end if;
  select * into v_row from public.supplier_payments where id = p_payment_id for update;
  if v_row.id is null then raise exception 'Payment not found'; end if;
  if v_role <> 'admin' and (v_role = 'cashier' or not (public.has_perm('purchases') or public.has_perm('accounts'))
                            or v_row.location_id is distinct from public.get_user_location(auth.uid())) then
    raise exception 'Your role doesn''t allow reversing supplier payments';
  end if;
  if v_row.reversed_at is not null then raise exception 'This payment was already reversed'; end if;
  update public.supplier_payments
     set reversed_at = now(), reversed_by = auth.uid(), reversal_reason = trim(p_reason)
   where id = p_payment_id
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.reverse_supplier_payment(uuid, text) to authenticated;

-- ---------- Balances (same columns as before, more at the end)
drop view if exists public.customer_balances;
create view public.customer_balances with (security_invoker = true) as
select
  c.id as customer_id,
  c.name,
  c.phone,
  c.location_id,
  (greatest(c.opening_balance, 0) + coalesce(cr.total, 0))::numeric(12,2) as credit_total,
  (greatest(-c.opening_balance, 0) + coalesce(pd.total, 0) + coalesce(rt.total, 0))::numeric(12,2) as paid_total,
  (c.opening_balance + coalesce(cr.total, 0) - coalesce(pd.total, 0) - coalesce(rt.total, 0))::numeric(12,2) as balance,
  greatest(cr.last_at, pd.last_at, rt.last_at) as last_activity,
  c.opening_balance,
  c.credit_limit,
  c.credit_days,
  c.customer_group,
  -- oldest bill not yet covered by payments (payments clear the oldest first)
  (select min(x.at) from (
     select o.at, sum(o.amt) over (order by o.at, o.k rows unbounded preceding) as cum
     from (
       select c.created_at as at, 0 as k, greatest(c.opening_balance, 0) as amt
       union all
       select s.created_at, 1, coalesce(s.credit_amount, case when s.payment_method = 'credit' then s.total_amount else 0 end)
       from public.sales s
       where s.customer_id = c.id and (s.payment_method = 'credit' or s.credit_amount > 0)
         and coalesce(s.status, 'completed') <> 'cancelled'
     ) o where o.amt > 0
   ) x
   where x.cum > greatest(-c.opening_balance, 0) + coalesce(pd.total, 0) + coalesce(rt.total, 0) + 0.005
  ) as oldest_due_at
from public.customers c
left join (
  select customer_id,
         sum(coalesce(credit_amount, case when payment_method = 'credit' then total_amount else 0 end)) as total,
         max(created_at) as last_at
  from public.sales
  where (payment_method = 'credit' or credit_amount > 0) and coalesce(status, 'completed') <> 'cancelled'
  group by customer_id
) cr on cr.customer_id = c.id
left join (
  select customer_id, sum(amount) as total, max(created_at) as last_at
  from public.customer_payments where reversed_at is null group by customer_id
) pd on pd.customer_id = c.id
left join (
  select customer_id, sum(refund_amount) as total, max(created_at) as last_at
  from public.sale_returns where refund_method = 'khata' group by customer_id
) rt on rt.customer_id = c.id;
grant select on public.customer_balances to authenticated;

drop view if exists public.supplier_balances;
create view public.supplier_balances with (security_invoker = true) as
select
  s.id as supplier_id,
  s.name,
  s.phone,
  s.gstin,
  s.location_id,
  (greatest(s.opening_balance, 0) + coalesce(pu.total, 0))::numeric(12,2) as purchase_total,
  (greatest(-s.opening_balance, 0) + coalesce(pd.total, 0))::numeric(12,2) as paid_total,
  (s.opening_balance + coalesce(pu.total, 0) - coalesce(pd.total, 0))::numeric(12,2) as balance,
  greatest(pu.last_at, pd.last_at) as last_activity,
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
   where x.cum > greatest(-s.opening_balance, 0) + coalesce(pd.total, 0) + 0.005
  ) as oldest_due_at
from public.suppliers s
left join (select supplier_id, sum(total_amount) as total, max(created_at) as last_at
           from public.purchases group by supplier_id) pu on pu.supplier_id = s.id
left join (select supplier_id, sum(amount) as total, max(created_at) as last_at
           from public.supplier_payments where reversed_at is null group by supplier_id) pd on pd.supplier_id = s.id;
grant select on public.supplier_balances to authenticated;

notify pgrst, 'reload schema';

-- =====================================================================
-- DailyKart: billing upgrade
--   * more offer types: flat Rs off, Buy X Get Y free, minimum bill value
--   * coupons with use limits
--   * most a cashier may discount, and manager approval by PIN above it
--   * bank transfer as a payment method
--   * best sellers for the quick-pick buttons
-- Only adds things. Safe to run more than once.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- Offer types
alter table public.offers add column if not exists offer_type text not null default 'percent';
alter table public.offers add column if not exists flat_amount numeric(10,2);
alter table public.offers add column if not exists buy_qty integer;
alter table public.offers add column if not exists get_qty integer;
alter table public.offers add column if not exists min_bill numeric(12,2);
alter table public.offers alter column percent drop not null;
alter table public.offers drop constraint if exists offers_percent_check;
alter table public.offers drop constraint if exists offers_type_ok;
alter table public.offers add constraint offers_type_ok check (
  (offer_type = 'percent' and percent > 0 and percent <= 90)
  or (offer_type = 'flat' and flat_amount > 0)
  or (offer_type = 'bxgy' and buy_qty >= 1 and get_qty >= 1)
);
alter table public.offers drop constraint if exists offers_min_bill_ok;
alter table public.offers add constraint offers_min_bill_ok check (min_bill is null or min_bill >= 0);

-- ---------- Discount limit per store (null = no limit)
alter table public.locations add column if not exists max_discount_pct numeric(5,2);
do $$ begin
  alter table public.locations add constraint locations_max_discount_ok check (max_discount_pct is null or (max_discount_pct >= 0 and max_discount_pct <= 100));
exception when duplicate_object then null; end $$;

-- ---------- Manager PIN for approving bigger discounts
create table if not exists public.manager_pins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.manager_pins enable row level security;
-- nobody reads hashes directly; functions below do the work
revoke all on public.manager_pins from anon, authenticated;
grant all on public.manager_pins to service_role;

create table if not exists public.pin_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists idx_pin_attempts_user on public.pin_attempts(user_id, at);
alter table public.pin_attempts enable row level security;
revoke all on public.pin_attempts from anon, authenticated;

create table if not exists public.discount_approvals (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id) on delete restrict,
  sale_id uuid references public.sales(id) on delete set null,
  requested_by uuid not null default auth.uid() references auth.users(id),
  approved_by uuid not null references auth.users(id),
  percent numeric(6,2),
  amount numeric(12,2),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_discount_approvals_location on public.discount_approvals(location_id, created_at);
alter table public.discount_approvals enable row level security;
drop policy if exists "read discount_approvals" on public.discount_approvals;
create policy "read discount_approvals" on public.discount_approvals for select to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or requested_by = auth.uid()
         or ((has_perm('audit') or get_user_role(auth.uid()) = 'manager') and location_id = get_user_location(auth.uid())));
grant select on public.discount_approvals to authenticated;
grant all on public.discount_approvals to service_role;

create or replace function public.set_my_pin(p_pin text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if public.get_user_role(auth.uid()) not in ('admin', 'manager') then
    raise exception 'Only managers and admins have an approval PIN';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then raise exception 'PIN must be 4 to 6 digits'; end if;
  insert into public.manager_pins (user_id, pin_hash, updated_at)
  values (auth.uid(), crypt(p_pin, gen_salt('bf')), now())
  on conflict (user_id) do update set pin_hash = excluded.pin_hash, updated_at = now();
  return true;
end;
$$;
grant execute on function public.set_my_pin(text) to authenticated;

create or replace function public.has_my_pin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.manager_pins where user_id = auth.uid())
$$;
grant execute on function public.has_my_pin() to authenticated;

-- A manager or admin of this store types their PIN on the till.
-- Returns the approval id (null for a wrong PIN), which is linked to the bill after it is saved.
create or replace function public.approve_discount(p_pin text, p_percent numeric, p_amount numeric default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_loc uuid := public.get_user_location(auth.uid());
  v_approver uuid;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if (select count(*) from public.pin_attempts where user_id = auth.uid() and at > now() - interval '10 minutes') >= 5 then
    raise exception 'Too many wrong PINs. Wait 10 minutes.';
  end if;
  select mp.user_id into v_approver
  from public.manager_pins mp
  join public.user_roles ur on ur.user_id = mp.user_id
  where mp.pin_hash = crypt(coalesce(p_pin, ''), mp.pin_hash)
    and (ur.role = 'admin' or (ur.role = 'manager' and public.get_user_location(mp.user_id) = v_loc))
  limit 1;
  if v_approver is null then
    -- no error here, so the failed try is kept and counted
    insert into public.pin_attempts (user_id) values (auth.uid());
    return null;
  end if;
  insert into public.discount_approvals (location_id, requested_by, approved_by, percent, amount, note)
  values (v_loc, auth.uid(), v_approver, round(p_percent, 2), round(p_amount, 2), nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.approve_discount(text, numeric, numeric, text) to authenticated;

create or replace function public.attach_discount_approval(p_approval_id uuid, p_sale_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.discount_approvals set sale_id = p_sale_id
  where id = p_approval_id and requested_by = auth.uid() and sale_id is null
    and exists (select 1 from public.sales s where s.id = p_sale_id and s.cashier_id = auth.uid());
  return found;
end;
$$;
grant execute on function public.attach_discount_approval(uuid, uuid) to authenticated;

-- ---------- Coupons
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null default public.default_location() references public.locations(id) on delete cascade,
  code text not null,
  kind text not null default 'percent' check (kind in ('percent', 'flat')),
  value numeric(10,2) not null check (value > 0),
  min_bill numeric(12,2),
  max_uses integer check (max_uses is null or max_uses > 0),
  starts_on date,
  ends_on date,
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (kind <> 'percent' or value <= 90),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create unique index if not exists uq_coupons_store_code on public.coupons(location_id, upper(code));
alter table public.coupons enable row level security;
drop policy if exists "store read coupons" on public.coupons;
create policy "store read coupons" on public.coupons for select to authenticated
  using (get_user_role(auth.uid()) = 'admin' or location_id = get_user_location(auth.uid()));
drop policy if exists "manager write coupons" on public.coupons;
create policy "manager write coupons" on public.coupons for all to authenticated
  using (get_user_role(auth.uid()) = 'admin' or (has_perm('offers') and location_id = get_user_location(auth.uid())))
  with check (get_user_role(auth.uid()) = 'admin' or (has_perm('offers') and location_id = get_user_location(auth.uid())));
grant select, insert, update, delete on public.coupons to authenticated;
grant all on public.coupons to service_role;

create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete restrict,
  sale_id uuid not null unique references public.sales(id) on delete cascade,
  location_id uuid references public.locations(id),
  discount numeric(12,2),
  used_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_coupon_redemptions_coupon on public.coupon_redemptions(coupon_id);
alter table public.coupon_redemptions enable row level security;
drop policy if exists "store read coupon_redemptions" on public.coupon_redemptions;
create policy "store read coupon_redemptions" on public.coupon_redemptions for select to authenticated
  using (get_user_role(auth.uid()) = 'admin' or location_id = get_user_location(auth.uid()));
grant select on public.coupon_redemptions to authenticated;
grant all on public.coupon_redemptions to service_role;

-- Is this code usable on a bill of this amount? Returns the coupon or raises why not.
create or replace function public.check_coupon(p_code text, p_bill_total numeric)
returns public.coupons language plpgsql stable security definer set search_path = public as $$
declare
  v public.coupons;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_used integer;
begin
  select * into v from public.coupons
  where upper(code) = upper(trim(coalesce(p_code, '')))
    and (location_id = public.get_user_location(auth.uid()) or public.get_user_role(auth.uid()) = 'admin')
  order by (location_id = public.get_user_location(auth.uid())) desc
  limit 1;
  if v.id is null then raise exception 'No such coupon'; end if;
  if not v.is_active then raise exception 'This coupon is switched off'; end if;
  if v.starts_on is not null and v.starts_on > v_today then raise exception 'This coupon starts on %', to_char(v.starts_on, 'DD Mon YYYY'); end if;
  if v.ends_on is not null and v.ends_on < v_today then raise exception 'This coupon ended on %', to_char(v.ends_on, 'DD Mon YYYY'); end if;
  if v.min_bill is not null and coalesce(p_bill_total, 0) < v.min_bill then
    raise exception 'This coupon needs a bill of at least Rs %', to_char(v.min_bill, 'FM999999990.00');
  end if;
  if v.max_uses is not null then
    select count(*) into v_used from public.coupon_redemptions where coupon_id = v.id;
    if v_used >= v.max_uses then raise exception 'This coupon has been used up'; end if;
  end if;
  return v;
end;
$$;
grant execute on function public.check_coupon(text, numeric) to authenticated;

-- Records the use after the bill is saved
create or replace function public.redeem_coupon(p_coupon_id uuid, p_sale_id uuid, p_discount numeric)
returns public.coupon_redemptions language plpgsql security definer set search_path = public as $$
declare
  v public.coupons;
  v_sale public.sales;
  v_row public.coupon_redemptions;
begin
  select * into v from public.coupons where id = p_coupon_id for update;
  if v.id is null then raise exception 'No such coupon'; end if;
  select * into v_sale from public.sales where id = p_sale_id;
  if v_sale.id is null or v_sale.cashier_id is distinct from auth.uid() then raise exception 'Bill not found'; end if;
  if v.max_uses is not null and (select count(*) from public.coupon_redemptions where coupon_id = v.id) >= v.max_uses then
    raise exception 'This coupon has been used up';
  end if;
  insert into public.coupon_redemptions (coupon_id, sale_id, location_id, discount)
  values (v.id, p_sale_id, v_sale.location_id, round(p_discount, 2))
  on conflict (sale_id) do nothing
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.redeem_coupon(uuid, uuid, numeric) to authenticated;

-- ---------- Bank transfer: allowed as a part of a split payment
-- (a bill paid fully by bank transfer is saved as a split of one part)
create or replace function public.create_sale_split(
  p_items jsonb,
  p_payments jsonb,
  p_customer_id uuid default null,
  p_location_id uuid default null
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales;
  v_key text;
  v_val numeric;
  v_sum numeric := 0;
  v_clean jsonb := '{}'::jsonb;
  v_credit numeric := 0;
begin
  if p_payments is null or jsonb_typeof(p_payments) <> 'object' then
    raise exception 'Enter how much was paid each way';
  end if;
  for v_key, v_val in select key, value::text::numeric from jsonb_each(p_payments) loop
    if v_key not in ('cash', 'upi', 'card', 'credit', 'bank') then
      raise exception 'Unknown payment method: %', v_key;
    end if;
    if v_val < 0 then raise exception 'Amounts can''t be negative'; end if;
    if v_val > 0 then
      v_clean := v_clean || jsonb_build_object(v_key, round(v_val, 2));
      v_sum := v_sum + round(v_val, 2);
    end if;
  end loop;
  v_credit := coalesce((v_clean->>'credit')::numeric, 0);
  if v_credit > 0 and p_customer_id is null then
    raise exception 'Udhaar (credit) part needs a customer. Pick or add the customer first.';
  end if;

  v_sale := public.create_sale(p_items, p_customer_id, 'cash', p_location_id);

  if abs(v_sum - v_sale.total_amount) > 0.009 and abs(v_sum - v_sale.total_amount) <= 0.05 then
    select key into v_key from jsonb_each_text(v_clean) order by value::numeric desc limit 1;
    v_clean := jsonb_set(v_clean, array[v_key], to_jsonb(round((v_clean->>v_key)::numeric + v_sale.total_amount - v_sum, 2)));
    v_credit := coalesce((v_clean->>'credit')::numeric, 0);
    v_sum := v_sale.total_amount;
  end if;
  if abs(v_sum - v_sale.total_amount) > 0.009 then
    raise exception 'Payments add up to % but the bill is %', v_sum, v_sale.total_amount;
  end if;

  update public.sales
  set payment_method = 'split', payment_split = v_clean, credit_amount = nullif(v_credit, 0)
  where id = v_sale.id
  returning * into v_sale;
  return v_sale;
end;
$$;
revoke all on function public.create_sale_split(jsonb, jsonb, uuid, uuid) from public, anon;
grant execute on function public.create_sale_split(jsonb, jsonb, uuid, uuid) to authenticated;

-- ---------- Best sellers for quick-pick (follows the viewer's access)
create or replace function public.top_sellers(p_location_id uuid default null, p_days integer default 30, p_limit integer default 8)
returns table (product_id uuid, quantity numeric)
language sql stable security invoker set search_path = public as $$
  select si.product_id, sum(si.quantity)::numeric
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))
    and (p_location_id is null or s.location_id = p_location_id)
    and coalesce(s.status, 'completed') <> 'cancelled'
    and si.product_id is not null
  group by si.product_id
  order by 2 desc
  limit least(greatest(coalesce(p_limit, 8), 1), 24)
$$;
grant execute on function public.top_sellers(uuid, integer, integer) to authenticated;

-- ---------- Audit the new tables too
do $$
declare t text;
begin
  if to_regprocedure('public.audit_row()') is not null then
    foreach t in array array['coupons', 'discount_approvals', 'coupon_redemptions'] loop
      execute format('drop trigger if exists trg_audit on public.%I', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';

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

-- =====================================================================
-- DailyKart: expenses upgrade
--   * how it was paid, who was paid, and whether the cash came from the till
--   * receipt photo (private storage)
--   * repeating expenses (rent, salary, electricity) added by themselves
--   * approval: big expenses by staff wait for a manager
--   * day closing takes away cash expenses paid from the till, and no longer
--     counts payments that were reversed
-- Only adds things. Old expenses count as approved, paid in cash.
-- Safe to run more than once.
-- =====================================================================

alter table public.expenses add column if not exists payment_method text not null default 'cash';
alter table public.expenses add column if not exists paid_from_till boolean not null default false;
alter table public.expenses add column if not exists payee text;
alter table public.expenses add column if not exists receipt_path text;
alter table public.expenses add column if not exists status text not null default 'approved';
alter table public.expenses add column if not exists approved_by uuid references auth.users(id);
alter table public.expenses add column if not exists approved_at timestamptz;
alter table public.expenses add column if not exists recurring_id uuid;
do $$ begin
  alter table public.expenses add constraint expenses_method_ok check (payment_method in ('cash', 'upi', 'card', 'bank', 'cheque'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.expenses add constraint expenses_status_ok check (status in ('pending', 'approved', 'rejected'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.expenses add constraint expenses_amount_ok check (amount > 0) not valid;
exception when duplicate_object then null; end $$;
create index if not exists idx_expenses_status on public.expenses(location_id, status) where status <> 'approved';

-- Staff expenses above this amount wait for a manager (null = no approval needed)
alter table public.locations add column if not exists expense_approval_above numeric(12,2);

-- ---------- Status is set by the database, and only managers change it
create or replace function public.expense_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.get_user_role(auth.uid());
  v_limit numeric;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null or v_role in ('admin', 'manager', 'accountant') then
      new.status := coalesce(nullif(new.status, 'pending'), 'approved');
      if new.status = 'approved' and auth.uid() is not null then
        new.approved_by := auth.uid(); new.approved_at := now();
      end if;
    else
      select expense_approval_above into v_limit from public.locations where id = new.location_id;
      new.status := case when v_limit is not null and new.amount > v_limit then 'pending' else 'approved' end;
      new.approved_by := null; new.approved_at := null;
    end if;
    return new;
  end if;
  -- update
  if (new.status is distinct from old.status or new.approved_by is distinct from old.approved_by)
     and auth.uid() is not null and v_role not in ('admin', 'manager', 'accountant') then
    raise exception 'Only a manager can approve expenses';
  end if;
  if auth.uid() is not null and v_role not in ('admin', 'manager', 'accountant') and old.status <> 'pending' then
    raise exception 'Only a manager can change an approved expense';
  end if;
  return new;
end;
$$;
drop trigger if exists expenses_rules on public.expenses;
create trigger expenses_rules before insert or update on public.expenses
  for each row execute function public.expense_rules();

create or replace function public.decide_expense(p_expense_id uuid, p_approve boolean)
returns public.expenses language plpgsql security definer set search_path = public as $$
declare
  v_row public.expenses;
  v_role text := public.get_user_role(auth.uid());
begin
  select * into v_row from public.expenses where id = p_expense_id for update;
  if v_row.id is null then raise exception 'Expense not found'; end if;
  if v_role <> 'admin' and (v_role not in ('manager', 'accountant') or v_row.location_id is distinct from public.get_user_location(auth.uid())) then
    raise exception 'Only a manager can approve expenses';
  end if;
  update public.expenses
     set status = case when p_approve then 'approved' else 'rejected' end, approved_by = auth.uid(), approved_at = now()
   where id = p_expense_id
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.decide_expense(uuid, boolean) to authenticated;

-- ---------- Repeating expenses
create table if not exists public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  category text not null,
  amount numeric(10,2) not null check (amount > 0),
  payee text,
  description text,
  payment_method text not null default 'cash' check (payment_method in ('cash', 'upi', 'card', 'bank', 'cheque')),
  frequency text not null default 'monthly' check (frequency in ('weekly', 'monthly')),
  next_date date not null,
  is_active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_recurring_expenses_location on public.recurring_expenses(location_id) where is_active;
alter table public.recurring_expenses enable row level security;
drop policy if exists "store read recurring_expenses" on public.recurring_expenses;
create policy "store read recurring_expenses" on public.recurring_expenses for select to authenticated
  using (get_user_role(auth.uid()) = 'admin' or (has_perm('expenses') and location_id = get_user_location(auth.uid())));
drop policy if exists "manager write recurring_expenses" on public.recurring_expenses;
create policy "manager write recurring_expenses" on public.recurring_expenses for all to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or (get_user_role(auth.uid()) in ('manager', 'accountant') and location_id = get_user_location(auth.uid())))
  with check (get_user_role(auth.uid()) = 'admin'
         or (get_user_role(auth.uid()) in ('manager', 'accountant') and location_id = get_user_location(auth.uid())));
grant select, insert, update, delete on public.recurring_expenses to authenticated;
grant all on public.recurring_expenses to service_role;

-- Adds every repeating expense that has come due (up to today), once.
-- Called when a manager or accountant opens the Expenses page. Returns how many were added.
create or replace function public.post_recurring_expenses()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_r public.recurring_expenses;
  v_count integer := 0;
  v_guard integer;
begin
  if auth.uid() is null or public.get_user_role(auth.uid()) not in ('admin', 'manager', 'accountant') then return 0; end if;
  for v_r in
    select * from public.recurring_expenses
    where is_active and next_date <= v_today
      and (public.get_user_role(auth.uid()) = 'admin' or location_id = public.get_user_location(auth.uid()))
    for update skip locked
  loop
    v_guard := 0;
    while v_r.next_date <= v_today and v_guard < 60 loop
      insert into public.expenses (amount, category, description, date, created_by, location_id, payment_method, payee, status, recurring_id)
      values (v_r.amount, v_r.category, coalesce(v_r.description, 'Repeating expense'), v_r.next_date, v_r.created_by,
              v_r.location_id, v_r.payment_method, v_r.payee, 'approved', v_r.id);
      v_count := v_count + 1;
      v_guard := v_guard + 1;
      v_r.next_date := case when v_r.frequency = 'weekly' then v_r.next_date + 7 else (v_r.next_date + interval '1 month')::date end;
    end loop;
    update public.recurring_expenses set next_date = v_r.next_date where id = v_r.id;
  end loop;
  return v_count;
end;
$$;
grant execute on function public.post_recurring_expenses() to authenticated;

-- ---------- Receipt photos: private bucket, files kept under the store's id
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('expense-receipts', 'expense-receipts', false)
    on conflict (id) do nothing;
    execute 'drop policy if exists "store read expense receipts" on storage.objects';
    execute $p$create policy "store read expense receipts" on storage.objects for select to authenticated
      using (bucket_id = 'expense-receipts' and (public.get_user_role(auth.uid()) = 'admin'
             or (storage.foldername(name))[1] = public.get_user_location(auth.uid())::text))$p$;
    execute 'drop policy if exists "store add expense receipts" on storage.objects';
    execute $p$create policy "store add expense receipts" on storage.objects for insert to authenticated
      with check (bucket_id = 'expense-receipts' and (public.get_user_role(auth.uid()) = 'admin'
             or (storage.foldername(name))[1] = public.get_user_location(auth.uid())::text))$p$;
  end if;
end $$;

-- ---------- Day closing: cash expenses from the till, and no reversed payments
create or replace function public.register_totals(p_user uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select payment_method, total_amount, payment_split
    from public.sales
    where cashier_id = p_user and created_at >= p_from and created_at <= p_to
      and coalesce(status, 'completed') <> 'cancelled'
  ),
  by_method as (
    select
      coalesce(sum(case when payment_method = 'cash' then total_amount else coalesce((payment_split->>'cash')::numeric, 0) end), 0) as cash,
      coalesce(sum(case when payment_method = 'upi' then total_amount else coalesce((payment_split->>'upi')::numeric, 0) end), 0) as upi,
      coalesce(sum(case when payment_method = 'card' then total_amount else coalesce((payment_split->>'card')::numeric, 0) end), 0) as card,
      coalesce(sum(case when payment_method = 'credit' then total_amount else coalesce((payment_split->>'credit')::numeric, 0) end), 0) as credit,
      coalesce(sum(coalesce((payment_split->>'bank')::numeric, 0)), 0) as bank,
      count(*) as bills,
      coalesce(sum(total_amount), 0) as total
    from s
  )
  select jsonb_build_object(
    'bills', b.bills,
    'total_sales', b.total,
    'cash_sales', b.cash,
    'upi_sales', b.upi,
    'card_sales', b.card,
    'credit_sales', b.credit,
    'bank_sales', b.bank,
    'khata_cash_received', (select coalesce(sum(amount), 0) from public.customer_payments
                            where created_by = p_user and method = 'cash' and reversed_at is null
                              and created_at >= p_from and created_at <= p_to),
    'khata_upi_received', (select coalesce(sum(amount), 0) from public.customer_payments
                           where created_by = p_user and method = 'upi' and reversed_at is null
                             and created_at >= p_from and created_at <= p_to),
    'cash_refunds', (select coalesce(sum(refund_amount), 0) from public.sale_returns
                     where created_by = p_user and refund_method = 'cash' and created_at >= p_from and created_at <= p_to),
    'supplier_cash_paid', (select coalesce(sum(amount), 0) from public.supplier_payments
                           where created_by = p_user and method = 'cash' and reversed_at is null
                             and created_at >= p_from and created_at <= p_to),
    'expense_cash_paid', (select coalesce(sum(amount), 0) from public.expenses
                          where created_by = p_user and paid_from_till and payment_method = 'cash' and status <> 'rejected'
                            and created_at >= p_from and created_at <= p_to)
  )
  from by_method b
$$;
revoke all on function public.register_totals(uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.register_status()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_row public.register_sessions;
  v_t jsonb;
begin
  select * into v_row from public.register_sessions where user_id = auth.uid() and closed_at is null;
  if not found then return null; end if;
  v_t := public.register_totals(auth.uid(), v_row.opened_at, now());
  return jsonb_build_object(
    'session', to_jsonb(v_row),
    'totals', v_t,
    'expected_cash', v_row.opening_cash + (v_t->>'cash_sales')::numeric + (v_t->>'khata_cash_received')::numeric
                     - (v_t->>'cash_refunds')::numeric - (v_t->>'supplier_cash_paid')::numeric
                     - coalesce((v_t->>'expense_cash_paid')::numeric, 0)
  );
end;
$$;

create or replace function public.close_register(p_counted_cash numeric, p_note text default null)
returns public.register_sessions
language plpgsql security definer set search_path = public as $$
declare
  v_row public.register_sessions;
  v_t jsonb;
  v_expected numeric;
begin
  select * into v_row from public.register_sessions where user_id = auth.uid() and closed_at is null for update;
  if not found then raise exception 'No open register to close'; end if;
  if p_counted_cash is null or p_counted_cash < 0 then raise exception 'Enter the cash counted in the drawer'; end if;
  v_t := public.register_totals(auth.uid(), v_row.opened_at, now());
  v_expected := v_row.opening_cash + (v_t->>'cash_sales')::numeric + (v_t->>'khata_cash_received')::numeric
                - (v_t->>'cash_refunds')::numeric - (v_t->>'supplier_cash_paid')::numeric
                - coalesce((v_t->>'expense_cash_paid')::numeric, 0);
  update public.register_sessions
  set closed_at = now(), counted_cash = round(p_counted_cash, 2), expected_cash = round(v_expected, 2),
      difference = round(p_counted_cash - v_expected, 2), totals = v_t,
      note = nullif(trim(coalesce(p_note, '')), '')
  where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.register_status() from public, anon;
revoke all on function public.close_register(numeric, text) from public, anon;
grant execute on function public.register_status() to authenticated;
grant execute on function public.close_register(numeric, text) to authenticated;

-- ---------- Audit the new table too
do $$ begin
  if to_regprocedure('public.audit_row()') is not null then
    execute 'drop trigger if exists trg_audit on public.recurring_expenses';
    execute 'create trigger trg_audit after insert or update or delete on public.recurring_expenses for each row execute function public.audit_row()';
  end if;
end $$;

notify pgrst, 'reload schema';

-- =====================================================================
-- DailyKart: accounting
--   * chart of accounts (fixed shop accounts + your own)
--   * every bill, return, payment, purchase, expense and stock change is
--     read as a double-entry journal straight from where it is saved, so
--     the books always match the shop (nothing is copied, nothing to
--     drift, and billing is never slowed or blocked by accounting)
--   * manual journals (with reversal) for things like owner's money,
--     loans, rent deposit
--   * account balances for trial balance, profit & loss and balance sheet
-- Only adds things. Safe to run more than once.
-- =====================================================================

create table if not exists public.accounts (
  code text primary key,
  name text not null,
  type text not null check (type in ('asset', 'liability', 'equity', 'income', 'expense')),
  is_system boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.accounts enable row level security;
drop policy if exists "read accounts" on public.accounts;
create policy "read accounts" on public.accounts for select to authenticated using (true);
grant select on public.accounts to authenticated;
grant all on public.accounts to service_role;

insert into public.accounts (code, name, type, is_system) values
  ('1000', 'Cash in hand', 'asset', true),
  ('1010', 'Bank (UPI, card, transfer)', 'asset', true),
  ('1100', 'Customers (udhaar)', 'asset', true),
  ('1200', 'Stock', 'asset', true),
  ('1300', 'Input GST', 'asset', true),
  ('2000', 'Suppliers', 'liability', true),
  ('2100', 'Output GST', 'liability', true),
  ('3000', 'Owner''s capital', 'equity', true),
  ('4000', 'Sales', 'income', true),
  ('4100', 'Sales returns', 'income', true),
  ('5000', 'Cost of goods sold', 'expense', true),
  ('5100', 'Stock written off / found', 'expense', true),
  ('6000', 'Expenses', 'expense', true)
on conflict (code) do nothing;

-- Your own accounts get the next free code in their group
create or replace function public.add_account(p_name text, p_type text)
returns public.accounts language plpgsql security definer set search_path = public as $$
declare
  v_base integer := case p_type when 'asset' then 1500 when 'liability' then 2500 when 'equity' then 3100
                                when 'income' then 4500 when 'expense' then 6500 end;
  v_code integer;
  v_row public.accounts;
begin
  if not public.has_perm('accounts') then raise exception 'Your role doesn''t allow accounts'; end if;
  if v_base is null then raise exception 'Pick asset, liability, equity, income or expense'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the account a name'; end if;
  if exists (select 1 from public.accounts where lower(name) = lower(trim(p_name))) then raise exception 'An account with this name already exists'; end if;
  perform pg_advisory_xact_lock(hashtext('add_account'));
  select coalesce(max(code::integer), v_base - 1) + 1 into v_code
  from public.accounts where code ~ '^[0-9]+$' and code::integer between v_base and v_base + 499;
  insert into public.accounts (code, name, type) values (v_code::text, trim(p_name), p_type) returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.add_account(text, text) to authenticated;

-- ---------- Manual journals
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_number text not null,
  location_id uuid not null references public.locations(id) on delete restrict,
  entry_date date not null,
  narration text not null,
  reversal_of uuid references public.journal_entries(id),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists uq_journal_reversal on public.journal_entries(reversal_of) where reversal_of is not null;
create index if not exists idx_journal_entries_location on public.journal_entries(location_id, entry_date);

create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_code text not null references public.accounts(code),
  sub text,
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  check ((debit > 0) <> (credit > 0))
);
create index if not exists idx_journal_lines_entry on public.journal_lines(entry_id);

alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
drop policy if exists "read journal_entries" on public.journal_entries;
create policy "read journal_entries" on public.journal_entries for select to authenticated
  using (public.get_user_role(auth.uid()) = 'admin' or (public.has_perm('accounts') and location_id = public.get_user_location(auth.uid())));
drop policy if exists "read journal_lines" on public.journal_lines;
create policy "read journal_lines" on public.journal_lines for select to authenticated
  using (exists (select 1 from public.journal_entries j where j.id = entry_id));
grant select on public.journal_entries, public.journal_lines to authenticated;
grant all on public.journal_entries, public.journal_lines to service_role;

--   p_lines: [{"account_code": "3000", "debit": 0, "credit": 50000, "sub": null}, ...]
create or replace function public.post_journal(p_date date, p_narration text, p_lines jsonb, p_location_id uuid default null)
returns public.journal_entries language plpgsql security definer set search_path = public as $$
declare
  v_loc uuid := case when public.get_user_role(auth.uid()) = 'admin' then coalesce(p_location_id, public.get_user_location(auth.uid()))
                     else public.get_user_location(auth.uid()) end;
  v_row public.journal_entries;
  v_dr numeric := 0;
  v_cr numeric := 0;
  v_l record;
begin
  if auth.uid() is null then raise exception 'Please sign in again'; end if;
  if not public.has_perm('accounts') then raise exception 'Your role doesn''t allow accounts'; end if;
  if v_loc is null then raise exception 'Pick a store first'; end if;
  if coalesce(trim(p_narration), '') = '' then raise exception 'Write what this entry is for'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'A journal needs at least two lines';
  end if;
  for v_l in select coalesce((e->>'debit')::numeric, 0) as dr, coalesce((e->>'credit')::numeric, 0) as cr, e->>'account_code' as code
             from jsonb_array_elements(p_lines) e loop
    if v_l.dr < 0 or v_l.cr < 0 or (v_l.dr > 0) = (v_l.cr > 0) then raise exception 'Each line is either a debit or a credit'; end if;
    if not exists (select 1 from public.accounts where code = v_l.code) then raise exception 'Unknown account %', v_l.code; end if;
    v_dr := v_dr + round(v_l.dr, 2);
    v_cr := v_cr + round(v_l.cr, 2);
  end loop;
  if v_dr <> v_cr then raise exception 'Debits (%) and credits (%) must be equal', v_dr, v_cr; end if;

  insert into public.journal_entries (entry_number, location_id, entry_date, narration)
  values (public.next_doc_number(v_loc, 'JV'), v_loc, coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date), trim(p_narration))
  returning * into v_row;
  insert into public.journal_lines (entry_id, account_code, sub, debit, credit)
  select v_row.id, e->>'account_code', nullif(trim(coalesce(e->>'sub', '')), ''),
         round(coalesce((e->>'debit')::numeric, 0), 2), round(coalesce((e->>'credit')::numeric, 0), 2)
  from jsonb_array_elements(p_lines) e;
  return v_row;
end;
$$;
grant execute on function public.post_journal(date, text, jsonb, uuid) to authenticated;

create or replace function public.reverse_journal(p_entry_id uuid, p_reason text default null)
returns public.journal_entries language plpgsql security definer set search_path = public as $$
declare
  v_old public.journal_entries;
  v_row public.journal_entries;
begin
  if not public.has_perm('accounts') then raise exception 'Your role doesn''t allow accounts'; end if;
  select * into v_old from public.journal_entries where id = p_entry_id;
  if v_old.id is null then raise exception 'Entry not found'; end if;
  if public.get_user_role(auth.uid()) <> 'admin' and v_old.location_id <> public.get_user_location(auth.uid()) then
    raise exception 'This entry belongs to another store';
  end if;
  if v_old.reversal_of is not null then raise exception 'This is already a reversal'; end if;
  if exists (select 1 from public.journal_entries where reversal_of = p_entry_id) then raise exception 'This entry was already reversed'; end if;
  insert into public.journal_entries (entry_number, location_id, entry_date, narration, reversal_of)
  values (public.next_doc_number(v_old.location_id, 'JV'), v_old.location_id, (now() at time zone 'Asia/Kolkata')::date,
          'Reversal of ' || v_old.entry_number || coalesce(': ' || nullif(trim(p_reason), ''), ''), v_old.id)
  returning * into v_row;
  insert into public.journal_lines (entry_id, account_code, sub, debit, credit)
  select v_row.id, account_code, sub, credit, debit from public.journal_lines where entry_id = v_old.id;
  return v_row;
end;
$$;
grant execute on function public.reverse_journal(uuid, text) to authenticated;

-- ---------- Every transaction as journal lines (follows the viewer's access)
create or replace view public.ledger_entries with (security_invoker = true) as
-- bills
select s.location_id, (s.created_at at time zone 'Asia/Kolkata')::date as entry_date, 'sale'::text as source_type, s.id as source_id,
       s.invoice_number as ref, v.code as account_code, null::text as sub, v.dr::numeric(14,2) as debit, v.cr::numeric(14,2) as credit
from public.sales s
cross join lateral (
  select
    case s.payment_method when 'cash' then coalesce(s.total_amount, 0) when 'split' then coalesce((s.payment_split->>'cash')::numeric, 0) else 0 end as cash,
    coalesce(s.credit_amount, case when s.payment_method = 'credit' then s.total_amount else 0 end, 0) as udhaar
) p0
cross join lateral (select p0.cash, p0.udhaar, coalesce(s.total_amount, 0) - p0.cash - p0.udhaar as bank) p
cross join lateral (values
  ('1000', p.cash, 0::numeric), ('1010', p.bank, 0), ('1100', p.udhaar, 0),
  ('4000', 0, coalesce(s.total_amount, 0) - coalesce(s.tax_amount, 0)), ('2100', 0, coalesce(s.tax_amount, 0))
) v(code, dr, cr)
where coalesce(s.status, 'completed') <> 'cancelled' and (v.dr <> 0 or v.cr <> 0)

union all
-- returns from customers
select r.location_id, (r.created_at at time zone 'Asia/Kolkata')::date, 'return', r.id, r.return_number, v.code, null, v.dr, v.cr
from public.sale_returns r
cross join lateral (values
  ('4100', r.refund_amount - r.tax_amount, 0::numeric), ('2100', r.tax_amount, 0),
  (case r.refund_method when 'cash' then '1000' when 'khata' then '1100' else '1010' end, 0, r.refund_amount)
) v(code, dr, cr)
where v.dr <> 0 or v.cr <> 0

union all
-- udhaar received
select cp.location_id, (cp.created_at at time zone 'Asia/Kolkata')::date, 'khata_payment', cp.id, cp.note, v.code, null, v.dr, v.cr
from public.customer_payments cp
cross join lateral (values (case cp.method when 'cash' then '1000' else '1010' end, cp.amount, 0::numeric), ('1100', 0, cp.amount)) v(code, dr, cr)
where cp.reversed_at is null

union all
-- supplier bills
select pu.location_id, pu.bill_date, 'purchase', pu.id, pu.bill_number, v.code, null, v.dr, v.cr
from public.purchases pu
cross join lateral (values ('1200', pu.taxable_amount, 0::numeric), ('1300', pu.tax_amount, 0), ('2000', 0, pu.total_amount)) v(code, dr, cr)
where v.dr <> 0 or v.cr <> 0

union all
-- paid to suppliers
select sp.location_id, (sp.created_at at time zone 'Asia/Kolkata')::date, 'supplier_payment', sp.id, sp.note, v.code, null, v.dr, v.cr
from public.supplier_payments sp
cross join lateral (values ('2000', sp.amount, 0::numeric), (case sp.method when 'cash' then '1000' else '1010' end, 0, sp.amount)) v(code, dr, cr)
where sp.reversed_at is null

union all
-- goods sent back to suppliers
select pr.location_id, (pr.created_at at time zone 'Asia/Kolkata')::date, 'purchase_return', pr.id, pr.return_number, v.code, null, v.dr, v.cr
from public.purchase_returns pr
cross join lateral (values ('2000', pr.total_amount, 0::numeric), ('1200', 0, pr.taxable_amount), ('1300', 0, pr.tax_amount)) v(code, dr, cr)
where v.dr <> 0 or v.cr <> 0

union all
-- expenses (approved)
select e.location_id, e.date, 'expense', e.id, e.payee, v.code, v.sub, v.dr, v.cr
from public.expenses e
cross join lateral (values
  ('6000', e.category, e.amount, 0::numeric),
  (case coalesce(e.payment_method, 'cash') when 'cash' then '1000' else '1010' end, null::text, 0, e.amount)
) v(code, sub, dr, cr)
where coalesce(e.status, 'approved') = 'approved'

union all
-- stock: cost of what was sold or returned, write-offs, opening stock
select m.location_id, (m.created_at at time zone 'Asia/Kolkata')::date, 'stock_' || m.movement_type, m.source_id, null, v.code, null, v.dr, v.cr
from public.stock_movements m
left join public.products pr on pr.id = m.product_id
cross join lateral (select round(abs(m.quantity_change) * coalesce(m.unit_cost, pr.cost_price, 0), 2) as amt) a
cross join lateral (values
  ('1200',
   case when m.quantity_change > 0 then a.amt else 0 end,
   case when m.quantity_change < 0 then a.amt else 0 end),
  (case when m.movement_type in ('sale', 'return') then '5000'
        when m.movement_type in ('opening') then '3000'
        else '5100' end,
   case when m.quantity_change < 0 then a.amt else 0 end,
   case when m.quantity_change > 0 then a.amt else 0 end)
) v(code, dr, cr)
where m.movement_type not in ('purchase', 'purchase_return') and a.amt > 0

union all
-- opening dues of customers and suppliers
select c.location_id, (c.created_at at time zone 'Asia/Kolkata')::date, 'opening_balance', c.id, c.name, v.code, null, v.dr, v.cr
from public.customers c
cross join lateral (values
  ('1100', greatest(c.opening_balance, 0), greatest(-c.opening_balance, 0)),
  ('3000', greatest(-c.opening_balance, 0), greatest(c.opening_balance, 0))
) v(code, dr, cr)
where c.opening_balance <> 0

union all
select s.location_id, (s.created_at at time zone 'Asia/Kolkata')::date, 'opening_balance', s.id, s.name, v.code, null, v.dr, v.cr
from public.suppliers s
cross join lateral (values
  ('2000', greatest(-s.opening_balance, 0), greatest(s.opening_balance, 0)),
  ('3000', greatest(s.opening_balance, 0), greatest(-s.opening_balance, 0))
) v(code, dr, cr)
where s.opening_balance <> 0

union all
-- manual journals
select j.location_id, j.entry_date, 'journal', j.id, j.entry_number, l.account_code, l.sub, l.debit, l.credit
from public.journal_entries j
join public.journal_lines l on l.entry_id = j.id;

grant select on public.ledger_entries to authenticated;

-- Totals per account for a date range (trial balance, P&L, balance sheet)
create or replace function public.account_balances(p_from date default null, p_to date default null, p_location_id uuid default null)
returns table (account_code text, sub text, name text, type text, debit numeric, credit numeric)
language sql stable security invoker set search_path = public as $$
  select le.account_code,
         case when le.account_code = '6000' then le.sub end as sub,
         coalesce(a.name, le.account_code) || case when le.account_code = '6000' and le.sub is not null then ': ' || le.sub else '' end,
         coalesce(a.type, 'asset'),
         sum(le.debit)::numeric(14,2), sum(le.credit)::numeric(14,2)
  from public.ledger_entries le
  left join public.accounts a on a.code = le.account_code
  where (p_from is null or le.entry_date >= p_from)
    and (p_to is null or le.entry_date <= p_to)
    and (p_location_id is null or le.location_id = p_location_id)
  group by 1, 2, 3, 4
  order by 1, 2
$$;
grant execute on function public.account_balances(date, date, uuid) to authenticated;

-- Lines of one account (cash book, bank book, any ledger), newest first
create or replace function public.account_ledger(p_account_code text, p_from date default null, p_to date default null, p_location_id uuid default null, p_limit integer default 500)
returns table (entry_date date, source_type text, source_id uuid, ref text, sub text, debit numeric, credit numeric)
language sql stable security invoker set search_path = public as $$
  select le.entry_date, le.source_type, le.source_id, le.ref, le.sub, le.debit, le.credit
  from public.ledger_entries le
  where le.account_code = p_account_code
    and (p_from is null or le.entry_date >= p_from)
    and (p_to is null or le.entry_date <= p_to)
    and (p_location_id is null or le.location_id = p_location_id)
  order by le.entry_date desc, le.source_type
  limit least(greatest(coalesce(p_limit, 500), 1), 5000)
$$;
grant execute on function public.account_ledger(text, date, date, uuid, integer) to authenticated;

do $$ begin
  if to_regprocedure('public.audit_row()') is not null then
    execute 'drop trigger if exists trg_audit on public.journal_entries';
    execute 'create trigger trg_audit after insert or update or delete on public.journal_entries for each row execute function public.audit_row()';
  end if;
end $$;

notify pgrst, 'reload schema';

-- =====================================================================
-- DailyKart: staff, attendance, shifts, advances, salary and commission
--   * staff list (with or without an app login), shift times, weekly off
--   * daily attendance (present, half day, absent, paid leave) marked by
--     the manager, or clock in / clock out by the staff member themself
--   * late marks against the shift start
--   * salary advances and monthly salary: earned pay + sales commission
--     + bonus - deductions - advances. Advances and salary are saved as
--     "Salary" expenses, so the till, expenses, P&L and books all match.
-- New permission "staff" (manager gets it once by default).
-- Only adds things. Safe to run more than once.
-- =====================================================================

-- one-time seeds (so re-running never undoes the owner's later changes)
create table if not exists public.schema_once (key text primary key, done_at timestamptz not null default now());
alter table public.schema_once enable row level security;

do $$ begin
  if not exists (select 1 from public.schema_once where key = 'perm_staff_manager') then
    insert into public.role_permissions (role, permission) values ('manager', 'staff') on conflict do nothing;
    insert into public.schema_once (key) values ('perm_staff_manager');
  end if;
end $$;

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  phone text,
  job_title text,
  user_id uuid references auth.users(id) on delete set null,
  pay_type text not null default 'monthly' check (pay_type in ('monthly', 'daily')),
  salary numeric(10,2) not null default 0 check (salary >= 0),       -- monthly salary or daily wage
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  shift_start time,
  shift_end time,
  weekly_off smallint check (weekly_off between 0 and 6),             -- 0 = Sunday
  joined_on date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_staff_user on public.staff(user_id) where user_id is not null;
create index if not exists idx_staff_location on public.staff(location_id);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  date date not null,
  status text not null default 'present' check (status in ('present', 'half_day', 'absent', 'paid_leave')),
  check_in timestamptz,
  check_out timestamptz,
  late_minutes integer not null default 0 check (late_minutes >= 0),
  note text,
  marked_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (staff_id, date)
);
create index if not exists idx_attendance_loc_date on public.attendance(location_id, date);

create table if not exists public.staff_advances (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  amount numeric(10,2) not null check (amount > 0),
  given_on date not null default ((now() at time zone 'Asia/Kolkata')::date),
  expense_id uuid references public.expenses(id) on delete set null,
  payroll_id uuid,
  note text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_staff_advances_staff on public.staff_advances(staff_id);

create table if not exists public.staff_payroll (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  month date not null check (extract(day from month) = 1),
  paid_days numeric(5,1) not null default 0,
  earned numeric(10,2) not null default 0,
  commission numeric(10,2) not null default 0,
  bonus numeric(10,2) not null default 0,
  deductions numeric(10,2) not null default 0,
  advances numeric(10,2) not null default 0,
  net_paid numeric(10,2) not null default 0,
  expense_id uuid references public.expenses(id) on delete set null,
  note text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (staff_id, month)
);

-- ---------- Access: staff permission in own store (admin everywhere); a staff member sees their own rows
alter table public.staff enable row level security;
alter table public.attendance enable row level security;
alter table public.staff_advances enable row level security;
alter table public.staff_payroll enable row level security;

create or replace function public.can_manage_staff(p_location_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.get_user_role(auth.uid()) = 'admin'
      or (public.has_perm('staff') and p_location_id = public.get_user_location(auth.uid()))
$$;
grant execute on function public.can_manage_staff(uuid) to authenticated;

drop policy if exists "read staff" on public.staff;
create policy "read staff" on public.staff for select to authenticated
  using (public.can_manage_staff(location_id) or user_id = auth.uid());
drop policy if exists "manage staff" on public.staff;
create policy "manage staff" on public.staff for all to authenticated
  using (public.can_manage_staff(location_id)) with check (public.can_manage_staff(location_id));

drop policy if exists "read attendance" on public.attendance;
create policy "read attendance" on public.attendance for select to authenticated
  using (public.can_manage_staff(location_id) or exists (select 1 from public.staff s where s.id = staff_id and s.user_id = auth.uid()));
drop policy if exists "manage attendance" on public.attendance;
create policy "manage attendance" on public.attendance for all to authenticated
  using (public.can_manage_staff(location_id)) with check (public.can_manage_staff(location_id));

drop policy if exists "read staff_advances" on public.staff_advances;
create policy "read staff_advances" on public.staff_advances for select to authenticated
  using (public.can_manage_staff(location_id) or exists (select 1 from public.staff s where s.id = staff_id and s.user_id = auth.uid()));
drop policy if exists "read staff_payroll" on public.staff_payroll;
create policy "read staff_payroll" on public.staff_payroll for select to authenticated
  using (public.can_manage_staff(location_id) or exists (select 1 from public.staff s where s.id = staff_id and s.user_id = auth.uid()));

grant select, insert, update, delete on public.staff, public.attendance to authenticated;
grant select on public.staff_advances, public.staff_payroll to authenticated;
grant all on public.staff, public.attendance, public.staff_advances, public.staff_payroll to service_role;

-- attendance rows always carry the staff member's store
create or replace function public.attendance_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select location_id into new.location_id from public.staff where id = new.staff_id;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_attendance_fill on public.attendance;
create trigger trg_attendance_fill before insert or update on public.attendance
  for each row execute function public.attendance_fill();

-- ---------- Clock in / out for the signed-in staff member
create or replace function public.my_staff_today()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('staff_id', s.id, 'name', s.name, 'shift_start', s.shift_start, 'shift_end', s.shift_end,
                            'check_in', a.check_in, 'check_out', a.check_out, 'status', a.status, 'late_minutes', a.late_minutes)
  from public.staff s
  left join public.attendance a on a.staff_id = s.id and a.date = (now() at time zone 'Asia/Kolkata')::date
  where s.user_id = auth.uid() and s.is_active
$$;
grant execute on function public.my_staff_today() to authenticated;

create or replace function public.clock_in()
returns public.attendance language plpgsql security definer set search_path = public as $$
declare
  v_staff public.staff;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_now_local time := (now() at time zone 'Asia/Kolkata')::time;
  v_late integer := 0;
  v_row public.attendance;
begin
  select * into v_staff from public.staff where user_id = auth.uid() and is_active;
  if v_staff.id is null then raise exception 'You are not on the staff list. Ask the manager to link your login.'; end if;
  if v_staff.shift_start is not null and v_now_local > v_staff.shift_start + interval '10 minutes' then
    v_late := floor(extract(epoch from (v_now_local - v_staff.shift_start)) / 60);
  end if;
  insert into public.attendance (staff_id, location_id, date, status, check_in, late_minutes, marked_by)
  values (v_staff.id, v_staff.location_id, v_today, 'present', now(), v_late, auth.uid())
  on conflict (staff_id, date) do update
    set check_in = coalesce(public.attendance.check_in, excluded.check_in),
        late_minutes = case when public.attendance.check_in is null then excluded.late_minutes else public.attendance.late_minutes end,
        status = case when public.attendance.status = 'absent' then 'present' else public.attendance.status end
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.clock_in() to authenticated;

create or replace function public.clock_out()
returns public.attendance language plpgsql security definer set search_path = public as $$
declare
  v_row public.attendance;
begin
  update public.attendance a set check_out = now()
  from public.staff s
  where s.id = a.staff_id and s.user_id = auth.uid()
    and a.date = (now() at time zone 'Asia/Kolkata')::date and a.check_in is not null
  returning a.* into v_row;
  if v_row.id is null then raise exception 'Clock in first'; end if;
  return v_row;
end;
$$;
grant execute on function public.clock_out() to authenticated;

-- ---------- Month summary: what each person has earned
--   monthly pay: salary minus a day's pay for each absent day (half for a half day)
--   daily pay:   wage x (present + half days / 2 + paid leave)
--   commission:  % of their bills (before GST) as cashier, when linked to a login
--   advances:    given and not yet settled in a salary
create or replace function public.staff_month_summary(p_month date, p_location_id uuid default null)
returns table (staff_id uuid, name text, job_title text, pay_type text, salary numeric, commission_pct numeric,
               present numeric, half_days numeric, absent numeric, paid_leave numeric, late_days numeric, unmarked numeric,
               paid_days numeric, earned numeric, sales_total numeric, commission numeric, advances numeric,
               payable numeric, paid boolean, net_paid numeric)
language sql stable security invoker set search_path = public as $$
  with m as (
    select date_trunc('month', p_month)::date as m0,
           (date_trunc('month', p_month) + interval '1 month - 1 day')::date as m1
  ), m2 as (
    select m0, m1, extract(day from m1)::numeric as days,
           least(m1, (now() at time zone 'Asia/Kolkata')::date) as upto
    from m
  )
  select s.id, s.name, s.job_title, s.pay_type, s.salary, s.commission_pct,
         coalesce(a.present, 0), coalesce(a.half_days, 0), coalesce(a.absent, 0), coalesce(a.paid_leave, 0), coalesce(a.late_days, 0),
         greatest(0, (m2.upto - greatest(m2.m0, coalesce(s.joined_on, m2.m0)) + 1) - coalesce(a.marked, 0))::numeric as unmarked,
         x.paid_days, x.earned, coalesce(sl.total, 0), round(coalesce(sl.total, 0) * s.commission_pct / 100, 2),
         coalesce(adv.total, 0),
         round(x.earned + round(coalesce(sl.total, 0) * s.commission_pct / 100, 2) - coalesce(adv.total, 0), 2),
         p.id is not null, p.net_paid
  from public.staff s
  cross join m2
  left join lateral (
    select count(*) filter (where status = 'present')::numeric as present,
           count(*) filter (where status = 'half_day')::numeric as half_days,
           count(*) filter (where status = 'absent')::numeric as absent,
           count(*) filter (where status = 'paid_leave')::numeric as paid_leave,
           count(*) filter (where late_minutes > 0)::numeric as late_days,
           count(*)::numeric as marked
    from public.attendance where staff_id = s.id and date between m2.m0 and m2.m1
  ) a on true
  cross join lateral (
    select round(case when s.pay_type = 'daily'
             then coalesce(a.present, 0) + coalesce(a.half_days, 0) / 2 + coalesce(a.paid_leave, 0)
             else greatest(0, m2.days - coalesce(a.absent, 0) - coalesce(a.half_days, 0) / 2) end, 1) as paid_days
  ) d
  cross join lateral (
    select d.paid_days,
           round(case when s.pay_type = 'daily' then s.salary * d.paid_days
                      else s.salary * d.paid_days / m2.days end, 2) as earned
  ) x
  left join lateral (
    select sum(coalesce(sa.total_amount, 0) - coalesce(sa.tax_amount, 0)) as total
    from public.sales sa
    where s.user_id is not null and sa.cashier_id = s.user_id and s.commission_pct > 0
      and coalesce(sa.status, 'completed') <> 'cancelled'
      and (sa.created_at at time zone 'Asia/Kolkata')::date between m2.m0 and m2.m1
  ) sl on true
  left join lateral (
    select sum(amount) as total from public.staff_advances
    where staff_id = s.id and payroll_id is null and given_on <= m2.m1
  ) adv on true
  left join public.staff_payroll p on p.staff_id = s.id and p.month = m2.m0
  where (s.is_active or p.id is not null)
    and (p_location_id is null or s.location_id = p_location_id)
    and (s.joined_on is null or s.joined_on <= m2.m1)
  order by s.name
$$;
grant execute on function public.staff_month_summary(date, uuid) to authenticated;

-- ---------- Advance: money given now, taken back from the next salary
create or replace function public.give_staff_advance(p_staff_id uuid, p_amount numeric, p_method text default 'cash', p_from_till boolean default true, p_note text default null)
returns public.staff_advances language plpgsql security definer set search_path = public as $$
declare
  v_staff public.staff;
  v_exp public.expenses;
  v_row public.staff_advances;
begin
  select * into v_staff from public.staff where id = p_staff_id;
  if v_staff.id is null then raise exception 'Staff member not found'; end if;
  if not public.can_manage_staff(v_staff.location_id) then raise exception 'Your role doesn''t allow staff pay'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the advance amount'; end if;
  insert into public.expenses (amount, category, description, date, created_by, location_id, payment_method, paid_from_till, payee)
  values (round(p_amount, 2), 'Salary', 'Advance' || coalesce(': ' || nullif(trim(p_note), ''), ''), (now() at time zone 'Asia/Kolkata')::date,
          auth.uid(), v_staff.location_id, coalesce(p_method, 'cash'), coalesce(p_from_till, true) and coalesce(p_method, 'cash') = 'cash', v_staff.name)
  returning * into v_exp;
  insert into public.staff_advances (staff_id, location_id, amount, expense_id, note)
  values (v_staff.id, v_staff.location_id, round(p_amount, 2), v_exp.id, nullif(trim(p_note), ''))
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.give_staff_advance(uuid, numeric, text, boolean, text) to authenticated;

-- ---------- Pay the month's salary (once per person per month)
create or replace function public.pay_staff_salary(p_staff_id uuid, p_month date, p_bonus numeric default 0, p_deductions numeric default 0,
                                                   p_method text default 'cash', p_from_till boolean default false, p_note text default null)
returns public.staff_payroll language plpgsql security definer set search_path = public as $$
declare
  v_staff public.staff;
  v_m0 date := date_trunc('month', p_month)::date;
  v_sum record;
  v_net numeric;
  v_exp public.expenses;
  v_row public.staff_payroll;
begin
  select * into v_staff from public.staff where id = p_staff_id for update;
  if v_staff.id is null then raise exception 'Staff member not found'; end if;
  if not public.can_manage_staff(v_staff.location_id) then raise exception 'Your role doesn''t allow staff pay'; end if;
  if v_m0 > (now() at time zone 'Asia/Kolkata')::date then raise exception 'This month hasn''t started yet'; end if;
  if exists (select 1 from public.staff_payroll where staff_id = p_staff_id and month = v_m0) then
    raise exception 'Salary for this month is already paid';
  end if;
  if coalesce(p_bonus, 0) < 0 or coalesce(p_deductions, 0) < 0 then raise exception 'Bonus and deductions can''t be negative'; end if;
  select * into v_sum from public.staff_month_summary(v_m0, v_staff.location_id) s where s.staff_id = p_staff_id;
  if v_sum.staff_id is null then raise exception 'Nothing to pay for this month'; end if;
  v_net := round(v_sum.earned + v_sum.commission + coalesce(p_bonus, 0) - coalesce(p_deductions, 0) - v_sum.advances, 2);
  if v_net < 0 then raise exception 'Advances (%) are more than this month''s pay. Lower the deductions or pay next month.', v_sum.advances; end if;
  if v_net > 0 then
    insert into public.expenses (amount, category, description, date, created_by, location_id, payment_method, paid_from_till, payee)
    values (v_net, 'Salary', 'Salary ' || to_char(v_m0, 'Mon YYYY') || coalesce(': ' || nullif(trim(p_note), ''), ''),
            (now() at time zone 'Asia/Kolkata')::date, auth.uid(), v_staff.location_id, coalesce(p_method, 'cash'),
            coalesce(p_from_till, false) and coalesce(p_method, 'cash') = 'cash', v_staff.name)
    returning * into v_exp;
  end if;
  insert into public.staff_payroll (staff_id, location_id, month, paid_days, earned, commission, bonus, deductions, advances, net_paid, expense_id, note)
  values (v_staff.id, v_staff.location_id, v_m0, v_sum.paid_days, v_sum.earned, v_sum.commission, coalesce(p_bonus, 0), coalesce(p_deductions, 0),
          v_sum.advances, v_net, v_exp.id, nullif(trim(p_note), ''))
  returning * into v_row;
  update public.staff_advances set payroll_id = v_row.id
  where staff_id = p_staff_id and payroll_id is null and given_on <= (v_m0 + interval '1 month - 1 day')::date;
  return v_row;
end;
$$;
grant execute on function public.pay_staff_salary(uuid, date, numeric, numeric, text, boolean, text) to authenticated;

do $$ begin
  if to_regprocedure('public.audit_row()') is not null then
    execute 'drop trigger if exists trg_audit on public.staff';
    execute 'create trigger trg_audit after insert or update or delete on public.staff for each row execute function public.audit_row()';
    execute 'drop trigger if exists trg_audit on public.staff_payroll';
    execute 'create trigger trg_audit after insert or update or delete on public.staff_payroll for each row execute function public.audit_row()';
  end if;
end $$;

notify pgrst, 'reload schema';

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

-- =====================================================================
-- DailyKart: alerts, owner snapshot and loyalty points history
--   * owner_alerts: one list of things that need attention (low stock,
--     expiring batches, overdue udhaar and supplier bills, expenses
--     waiting for approval, orders waiting, till not closed, cash short,
--     attendance not marked). Worked out live, each only for people whose
--     role can open that part of the app.
--   * owner_snapshot: today vs yesterday vs last week, month so far,
--     gross profit today, udhaar to collect, supplier dues, stock value,
--     and a per-store row for the owner.
--   * loyalty_ledger: points earned, taken back by returns, and used,
--     bill by bill, for one customer.
-- Read-only functions. Nothing is stored. Safe to run more than once.
-- =====================================================================

create or replace function public.owner_alerts(p_location_id uuid default null)
returns table (kind text, severity text, title text, detail text, item_count integer, link text)
language plpgsql stable security invoker set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_n integer;
  v_amt numeric;
  v_txt text;
begin
  -- stock
  if public.has_perm('stock') or public.has_perm('products') then
    select count(*), string_agg(name, ', ' order by stock_quantity) filter (where rn <= 3) into v_n, v_txt
    from (select name, stock_quantity, row_number() over (order by stock_quantity) rn
          from public.products
          where coalesce(is_active, true) and min_stock_level is not null and min_stock_level > 0
            and stock_quantity <= min_stock_level and (p_location_id is null or location_id = p_location_id)) x;
    if v_n > 0 then
      kind := 'low_stock'; severity := 'warning'; title := v_n || ' product' || case when v_n > 1 then 's' else '' end || ' running low';
      detail := v_txt || case when v_n > 3 then ' and more' else '' end; item_count := v_n; link := '/stock'; return next;
    end if;

    select count(*) into v_n from public.product_batches b
    where b.cleared_at is null and b.quantity > 0 and b.expiry_date is not null and b.expiry_date <= v_today + 7
      and (p_location_id is null or b.location_id = p_location_id);
    if v_n > 0 then
      kind := 'expiry'; severity := case when exists (select 1 from public.product_batches b where b.cleared_at is null and b.quantity > 0
                                                       and b.expiry_date < v_today and (p_location_id is null or b.location_id = p_location_id))
                                         then 'danger' else 'warning' end;
      title := v_n || ' batch' || case when v_n > 1 then 'es' else '' end || ' expired or expiring this week';
      detail := 'Sell first, return to the supplier or write off'; item_count := v_n; link := '/stock'; return next;
    end if;
  end if;

  -- udhaar
  if public.has_perm('khata') then
    select count(*), sum(balance) into v_n, v_amt from public.customer_balances
    where balance > 0 and credit_days is not null and oldest_due_at is not null
      and oldest_due_at + make_interval(days => credit_days) < now()
      and (p_location_id is null or location_id = p_location_id);
    if v_n > 0 then
      kind := 'udhaar_overdue'; severity := 'warning'; title := v_n || ' customer' || case when v_n > 1 then 's' else '' end || ' overdue on udhaar';
      detail := '₹' || to_char(v_amt, 'FM99,99,99,990') || ' to collect'; item_count := v_n; link := '/khata'; return next;
    end if;
  end if;

  -- suppliers
  if public.has_perm('purchases') or public.has_perm('accounts') then
    select count(*), sum(balance) into v_n, v_amt from public.supplier_balances
    where balance > 0 and credit_days is not null and oldest_due_at is not null
      and oldest_due_at + make_interval(days => credit_days) < now() + interval '3 days'
      and (p_location_id is null or location_id = p_location_id);
    if v_n > 0 then
      kind := 'supplier_due'; severity := 'info'; title := v_n || ' supplier bill' || case when v_n > 1 then 's' else '' end || ' due';
      detail := '₹' || to_char(v_amt, 'FM99,99,99,990') || ' due now or in the next 3 days'; item_count := v_n; link := '/purchases'; return next;
    end if;
  end if;

  -- expenses waiting
  if public.get_user_role(auth.uid()) in ('admin', 'manager', 'accountant') then
    select count(*), sum(amount) into v_n, v_amt from public.expenses
    where status = 'pending' and (p_location_id is null or location_id = p_location_id);
    if v_n > 0 then
      kind := 'expense_approval'; severity := 'info'; title := v_n || ' expense' || case when v_n > 1 then 's' else '' end || ' waiting for approval';
      detail := '₹' || to_char(v_amt, 'FM99,99,99,990'); item_count := v_n; link := '/expenses'; return next;
    end if;
  end if;

  -- orders
  if public.has_perm('sales') then
    select count(*) into v_n from public.customer_orders
    where status = 'new' and created_at < now() - interval '20 minutes' and (p_location_id is null or location_id = p_location_id);
    if v_n > 0 then
      kind := 'orders_waiting'; severity := 'danger'; title := v_n || ' order' || case when v_n > 1 then 's' else '' end || ' not started';
      detail := 'Waiting more than 20 minutes'; item_count := v_n; link := '/orders'; return next;
    end if;
    select count(*) into v_n from public.customer_orders
    where status not in ('delivered', 'cancelled') and expected_at is not null and expected_at < now()
      and (p_location_id is null or location_id = p_location_id);
    if v_n > 0 then
      kind := 'orders_late'; severity := 'warning'; title := v_n || ' order' || case when v_n > 1 then 's' else '' end || ' past the promised time';
      detail := null; item_count := v_n; link := '/orders'; return next;
    end if;
  end if;

  -- till
  if public.has_perm('register') and public.get_user_role(auth.uid()) in ('admin', 'manager') then
    select count(*) into v_n from public.register_sessions
    where closed_at is null and (opened_at at time zone 'Asia/Kolkata')::date < v_today
      and (p_location_id is null or location_id = p_location_id);
    if v_n > 0 then
      kind := 'till_open'; severity := 'warning'; title := v_n || ' till' || case when v_n > 1 then 's' else '' end || ' left open from an earlier day';
      detail := 'Close it on Day closing'; item_count := v_n; link := '/register'; return next;
    end if;
    select count(*), sum(difference) into v_n, v_amt from public.register_sessions
    where closed_at >= now() - interval '2 days' and difference < -50
      and (p_location_id is null or location_id = p_location_id);
    if v_n > 0 then
      kind := 'cash_short'; severity := 'danger'; title := 'Cash short at closing';
      detail := '₹' || to_char(-v_amt, 'FM99,99,99,990') || ' short in the last 2 days'; item_count := v_n; link := '/register'; return next;
    end if;
  end if;

  -- attendance (after 11 am)
  if public.has_perm('staff') and (now() at time zone 'Asia/Kolkata')::time > time '11:00' then
    select count(*) into v_n from public.staff s
    where s.is_active and (s.weekly_off is null or s.weekly_off <> extract(dow from v_today))
      and (p_location_id is null or s.location_id = p_location_id)
      and not exists (select 1 from public.attendance a where a.staff_id = s.id and a.date = v_today);
    if v_n > 0 then
      kind := 'attendance'; severity := 'info'; title := 'Attendance not marked for ' || v_n || ' staff';
      detail := null; item_count := v_n; link := '/staff'; return next;
    end if;
  end if;
end;
$$;
grant execute on function public.owner_alerts(uuid) to authenticated;

-- ---------- Owner snapshot (follows the caller's access)
create or replace function public.owner_snapshot(p_location_id uuid default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  with d as (
    select (now() at time zone 'Asia/Kolkata')::date as today,
           ((now() at time zone 'Asia/Kolkata') - interval '1 day')::date as yday,
           ((now() at time zone 'Asia/Kolkata') - interval '7 day')::date as lastweek,
           date_trunc('month', now() at time zone 'Asia/Kolkata')::date as m0,
           (date_trunc('month', now() at time zone 'Asia/Kolkata') - interval '1 month')::date as pm0,
           (now() at time zone 'Asia/Kolkata' - interval '1 month')::date as pm_same
  ), s as (
    select x.location_id, (x.created_at at time zone 'Asia/Kolkata')::date as day,
           coalesce(x.total_amount, 0) as total, coalesce(x.tax_amount, 0) as tax
    from public.sales x, d
    where coalesce(x.status, 'completed') <> 'cancelled'
      and x.created_at >= (d.pm0::timestamp at time zone 'Asia/Kolkata')
      and (p_location_id is null or x.location_id = p_location_id)
  ), cogs as (
    select coalesce(sum(-m.quantity_change * coalesce(m.unit_cost, 0)), 0) as amt
    from public.stock_movements m, d
    where m.movement_type = 'sale' and (m.created_at at time zone 'Asia/Kolkata')::date = d.today
      and (p_location_id is null or m.location_id = p_location_id)
  )
  select jsonb_build_object(
    'today', (select coalesce(sum(total), 0) from s, d where day = d.today),
    'today_bills', (select count(*) from s, d where day = d.today),
    'yesterday', (select coalesce(sum(total), 0) from s, d where day = d.yday),
    'last_week_same_day', (select coalesce(sum(total), 0) from s, d where day = d.lastweek),
    'month', (select coalesce(sum(total), 0) from s, d where day >= d.m0),
    'last_month_same_period', (select coalesce(sum(total), 0) from s, d where day >= d.pm0 and day <= d.pm_same),
    'gross_profit_today', (select round(coalesce(sum(total - tax), 0) - (select amt from cogs), 2) from s, d where day = d.today),
    'udhaar_due', (select coalesce(sum(balance), 0) from public.customer_balances where balance > 0 and (p_location_id is null or location_id = p_location_id)),
    'supplier_due', (select coalesce(sum(balance), 0) from public.supplier_balances where balance > 0 and (p_location_id is null or location_id = p_location_id)),
    'stock_value', (select round(coalesce(sum(greatest(stock_quantity, 0) * coalesce(cost_price, 0)), 0), 2) from public.products
                    where coalesce(is_active, true) and (p_location_id is null or location_id = p_location_id)),
    'stores', (select coalesce(jsonb_agg(jsonb_build_object('location_id', l.id, 'name', l.name,
                        'today', (select coalesce(sum(total), 0) from s, d where s.location_id = l.id and day = d.today),
                        'month', (select coalesce(sum(total), 0) from s, d where s.location_id = l.id and day >= d.m0)) order by l.name), '[]'::jsonb)
               from public.locations l
               where (p_location_id is null or l.id = p_location_id)
                 and (public.get_user_role(auth.uid()) = 'admin' or l.id = public.get_user_location(auth.uid())))
  )
$$;
grant execute on function public.owner_snapshot(uuid) to authenticated;

-- ---------- Loyalty points history for one customer (newest first)
create or replace function public.loyalty_ledger(p_customer_id uuid)
returns table (at timestamptz, kind text, ref text, amount numeric, points integer)
language sql stable security invoker set search_path = public as $$
  with c as (
    select c.id, c.loyalty_points, c.created_at, l.loyalty_earn_per_100 as rate, l.loyalty_since
    from public.customers c join public.locations l on l.id = c.location_id
    where c.id = p_customer_id
  )
  select * from (
    select c.created_at, 'opening'::text, null::text, null::numeric, c.loyalty_points from c where coalesce(c.loyalty_points, 0) <> 0
    union all
    select x.created_at, 'earned', x.invoice_number, x.total_amount, floor(x.total_amount * c.rate / 100)::int
    from public.sales x, c where x.customer_id = c.id and x.created_at >= c.loyalty_since
    union all
    select r.created_at, 'returned', r.return_number, r.refund_amount, -floor(r.refund_amount * c.rate / 100)::int
    from public.sale_returns r, c where r.customer_id = c.id and r.created_at >= c.loyalty_since
    union all
    select lr.created_at, 'used', s.invoice_number, lr.value, -lr.points
    from public.loyalty_redemptions lr cross join c left join public.sales s on s.id = lr.sale_id where lr.customer_id = c.id
  ) t(at, kind, ref, amount, points)
  where points <> 0
  order by at desc
  limit 500
$$;
grant execute on function public.loyalty_ledger(uuid) to authenticated;

notify pgrst, 'reload schema';

-- =====================================================================
-- DailyKart: loose and weighed goods
--   * stock can hold parts of a unit (0.750 kg of rice, 1.5 L of oil):
--     products.stock_quantity and min_stock_level become numeric(12,3);
--     stock adjustments too. Whole numbers stay exactly as they are.
--   * products.sold_by: piece (default), weight (kg) or volume (L).
--     Bills with part of a piece are refused for piece products, so
--     nothing changes for them.
--   * products.plu_code + store scale settings, so labels printed by a
--     weighing scale (barcode with the item code and the weight or price
--     inside) can be scanned at billing.
-- Only widens and adds. Safe to run more than once.
-- =====================================================================

do $$ begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'products' and column_name = 'stock_quantity') = 'integer' then
    drop view if exists public.stock_ledger_check;
    -- the stock ledger trigger watches this column: take it off for the change and put it straight back
    drop trigger if exists trg_log_stock_movement on public.products;
    alter table public.products alter column stock_quantity type numeric(12,3);
    alter table public.products alter column min_stock_level type numeric(12,3);
    create trigger trg_log_stock_movement after insert or update of stock_quantity on public.products
      for each row execute function public.log_stock_movement();
  end if;
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'stock_adjustments' and column_name = 'quantity_change') = 'integer' then
    alter table public.stock_adjustments alter column quantity_change type numeric(12,3);
    alter table public.stock_adjustments alter column stock_before type numeric(12,3);
    alter table public.stock_adjustments alter column stock_after type numeric(12,3);
  end if;
end $$;

create or replace view public.stock_ledger_check
with (security_invoker = true) as
select p.id as product_id, p.name, p.location_id, coalesce(p.stock_quantity, 0) as stock_quantity,
       coalesce(sum(m.quantity_change), 0) as ledger_quantity
from public.products p
left join public.stock_movements m on m.product_id = p.id
group by p.id
having coalesce(p.stock_quantity, 0) <> coalesce(sum(m.quantity_change), 0);
grant select on public.stock_ledger_check to authenticated;

alter table public.products add column if not exists sold_by text not null default 'piece';
alter table public.products drop constraint if exists products_sold_by_ok;
alter table public.products add constraint products_sold_by_ok check (sold_by in ('piece', 'weight', 'volume'));
alter table public.products add column if not exists plu_code text;
create unique index if not exists uq_products_plu on public.products(location_id, plu_code) where plu_code is not null;

-- Scale labels: <prefix><item code><weight in grams or price in paise><check digit>, 13 digits
alter table public.locations add column if not exists scale_prefix text;            -- e.g. '21'; empty = scale labels off
alter table public.locations add column if not exists scale_value text not null default 'weight';
alter table public.locations drop constraint if exists locations_scale_value_ok;
alter table public.locations add constraint locations_scale_value_ok check (scale_value in ('weight', 'price'));
alter table public.locations add column if not exists scale_code_digits smallint not null default 5;
alter table public.locations drop constraint if exists locations_scale_digits_ok;
alter table public.locations add constraint locations_scale_digits_ok check (scale_code_digits between 4 and 6);

-- Piece products can't be billed in parts
create or replace function public.check_piece_quantity()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prod record;
begin
  if new.quantity <> trunc(new.quantity) then
    select name, sold_by into v_prod from public.products where id = new.product_id;
    if coalesce(v_prod.sold_by, 'piece') = 'piece' then
      raise exception '% is sold by the piece. Use a whole number.', coalesce(v_prod.name, 'This item');
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_check_piece_quantity on public.sale_items;
create trigger trg_check_piece_quantity before insert on public.sale_items
  for each row execute function public.check_piece_quantity();

-- Stock adjustment with parts of a unit (replaces the whole-number version)
drop function if exists public.adjust_stock(uuid, integer, text, text, text);
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_quantity numeric,
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
  v_before numeric;
  v_after numeric;
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
  if coalesce(v_prod.sold_by, 'piece') = 'piece' and p_quantity <> trunc(p_quantity) then
    raise exception '% is counted in whole pieces', v_prod.name;
  end if;

  v_before := coalesce(v_prod.stock_quantity, 0);
  v_after := round(case when p_mode = 'set' then p_quantity else v_before + p_quantity end, 3);
  if v_after < 0 then
    raise exception 'Stock for % can''t go below 0 (now %)', v_prod.name, trim_scale(v_before);
  end if;
  if v_after = v_before then
    raise exception 'Stock for % is already %', v_prod.name, trim_scale(v_before);
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
revoke all on function public.adjust_stock(uuid, numeric, text, text, text) from public, anon;
grant execute on function public.adjust_stock(uuid, numeric, text, text, text) to authenticated;

notify pgrst, 'reload schema';

-- =====================================================================
-- DailyKart: security hardening
--   * two-step login is enforced by the database: once a person turns on
--     an authenticator app, their data can only be read or changed after
--     they type its code (a stolen password alone is not enough)
--   * tighter write rules: only people whose role allows it can change
--     products, suppliers, expenses or record khata payments; bills and
--     bill lines can only be made through billing (no direct edits)
--   * functions can no longer be called by signed-out visitors
-- Safe to run more than once.
-- =====================================================================

-- ---------- Two-step login (Supabase Auth MFA)
-- true when this session passed the second step, or the person has no
-- authenticator turned on
create or replace function public.mfa_ok()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_aal text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', '');
  v_has boolean := false;
begin
  if auth.uid() is null or v_aal = 'aal2' then return true; end if;
  if to_regclass('auth.mfa_factors') is null then return true; end if;
  execute 'select exists (select 1 from auth.mfa_factors where user_id = $1 and status = ''verified'')' into v_has using auth.uid();
  return not v_has;
end;
$$;
grant execute on function public.mfa_ok() to authenticated;

-- one "restrictive" rule on every table, added on top of the existing ones
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
             and c.relname not in ('schema_once')
  loop
    execute format('drop policy if exists "two-step login" on public.%I', r.relname);
    execute format('create policy "two-step login" on public.%I as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))', r.relname);
  end loop;
end $$;

-- Same check before every API call, so functions (billing, payments...) are
-- covered too. If this setting can't be changed here, the table rules above
-- still apply.
create or replace function public.check_request()
returns void language plpgsql stable set search_path = public as $$
declare v_ok boolean := true;
begin
  begin
    v_ok := public.mfa_ok();
  exception when others then
    v_ok := true;  -- never block the app because of this check itself
  end;
  if not v_ok then
    raise exception 'Enter the code from your authenticator app to continue'
      using errcode = '42501', hint = 'two_step_login_needed';
  end if;
end;
$$;
grant execute on function public.check_request() to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.check_request() to anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    begin
      execute 'alter role authenticator set pgrst.db_pre_request to ''public.check_request''';
      notify pgrst, 'reload config';
    exception when others then
      raise notice 'Could not set the two-step check for API calls (%). Table rules still apply.', sqlerrm;
    end;
  end if;
end $$;

-- ---------- Tighter write rules
-- products: Products permission (owner everywhere)
drop policy if exists "store insert products" on public.products;
create policy "store insert products" on public.products for insert to authenticated
  with check (public.get_user_role(auth.uid()) = 'admin'
              or (public.has_perm('products') and location_id = public.get_user_location(auth.uid())));
drop policy if exists "store update products" on public.products;
create policy "store update products" on public.products for update to authenticated
  using (public.get_user_role(auth.uid()) = 'admin'
         or (public.has_perm('products') and location_id = public.get_user_location(auth.uid())))
  with check (public.get_user_role(auth.uid()) = 'admin'
              or (public.has_perm('products') and location_id = public.get_user_location(auth.uid())));

-- bills and bill lines: only through the billing functions (owner can still repair)
drop policy if exists "store insert sales" on public.sales;
create policy "store insert sales" on public.sales for insert to authenticated
  with check (public.get_user_role(auth.uid()) = 'admin');
drop policy if exists "store update sales" on public.sales;
create policy "store update sales" on public.sales for update to authenticated
  using (public.get_user_role(auth.uid()) = 'admin') with check (public.get_user_role(auth.uid()) = 'admin');
drop policy if exists "store insert sale_items" on public.sale_items;
create policy "store insert sale_items" on public.sale_items for insert to authenticated
  with check (public.get_user_role(auth.uid()) = 'admin');
drop policy if exists "store update sale_items" on public.sale_items;
create policy "store update sale_items" on public.sale_items for update to authenticated
  using (public.get_user_role(auth.uid()) = 'admin');

-- suppliers: Purchases or Accounts permission
drop policy if exists "store insert suppliers" on public.suppliers;
create policy "store insert suppliers" on public.suppliers for insert to authenticated
  with check (public.get_user_role(auth.uid()) = 'admin'
              or ((public.has_perm('purchases') or public.has_perm('accounts')) and location_id = public.get_user_location(auth.uid())));
drop policy if exists "store update suppliers" on public.suppliers;
create policy "store update suppliers" on public.suppliers for update to authenticated
  using (public.get_user_role(auth.uid()) = 'admin'
         or ((public.has_perm('purchases') or public.has_perm('accounts')) and location_id = public.get_user_location(auth.uid())))
  with check (public.get_user_role(auth.uid()) = 'admin'
              or ((public.has_perm('purchases') or public.has_perm('accounts')) and location_id = public.get_user_location(auth.uid())));

-- khata payments: Khata permission
drop policy if exists "store insert customer_payments" on public.customer_payments;
create policy "store insert customer_payments" on public.customer_payments for insert to authenticated
  with check (public.get_user_role(auth.uid()) = 'admin'
              or (public.has_perm('khata') and location_id = public.get_user_location(auth.uid())));

-- expenses: Expenses permission (salary and advances go through their own functions)
drop policy if exists "store insert expenses" on public.expenses;
create policy "store insert expenses" on public.expenses for insert to authenticated
  with check (public.get_user_role(auth.uid()) = 'admin'
              or (public.has_perm('expenses') and location_id = public.get_user_location(auth.uid())));
drop policy if exists "store update expenses" on public.expenses;
create policy "store update expenses" on public.expenses for update to authenticated
  using (public.get_user_role(auth.uid()) = 'admin'
         or (public.has_perm('expenses') and location_id = public.get_user_location(auth.uid())))
  with check (public.get_user_role(auth.uid()) = 'admin'
              or (public.has_perm('expenses') and location_id = public.get_user_location(auth.uid())));

-- ---------- Functions: signed-in people only
-- Keeps exactly the signed-in access each function has today; removes the
-- signed-out (anon / everyone) access. Run again after adding functions.
create or replace function public.secure_function_grants()
returns void language plpgsql set search_path = public as $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, has_function_privilege('authenticated', p.oid, 'execute') as signed_in
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')  -- not extension functions
      and p.proname <> 'check_request'  -- runs before every API call, also for signed-out visitors
  loop
    if r.signed_in then execute format('grant execute on function %s to authenticated', r.sig); end if;
    execute format('revoke execute on function %s from public', r.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', r.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', r.sig); end if;
  end loop;
end;
$$;

select public.secure_function_grants();
revoke execute on function public.secure_function_grants() from authenticated;
-- internal only: used by the udhaar limit check
revoke execute on function public.customer_due(uuid) from authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.check_request() to anon';
  end if;
end $$;

-- new functions start without signed-out access
alter default privileges revoke execute on functions from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'alter default privileges in schema public revoke execute on functions from anon';
  end if;
end $$;

notify pgrst, 'reload schema';

-- =====================================================================
-- DailyKart: GST e-invoice (IRN) for bills to registered businesses
--   * e_invoices: the IRN, acknowledgement number and date, and the
--     signed QR code the government portal gives back for a bill, so
--     the bill can be printed as an e-invoice. Bills themselves are not
--     changed.
--   * save_e_invoice / cancel_e_invoice: for people with the Reports or
--     Accounts permission in that bill's store.
-- Only adds. Safe to run more than once.
-- =====================================================================

create table if not exists public.e_invoices (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  irn text not null,
  ack_no text,
  ack_date timestamptz,
  signed_qr text,
  status text not null default 'active',
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint e_invoices_status_ok check (status in ('active', 'cancelled')),
  constraint e_invoices_irn_ok check (irn ~ '^[0-9a-f]{64}$')
);
create unique index if not exists uq_e_invoices_active_sale on public.e_invoices(sale_id) where status = 'active';
create unique index if not exists uq_e_invoices_irn on public.e_invoices(irn);
create index if not exists idx_e_invoices_location on public.e_invoices(location_id, created_at);

alter table public.e_invoices enable row level security;
drop policy if exists "read e_invoices" on public.e_invoices;
create policy "read e_invoices" on public.e_invoices for select to authenticated
  using (public.get_user_role(auth.uid()) = 'admin' or location_id = public.get_user_location(auth.uid()));
grant select on public.e_invoices to authenticated;
do $$ begin
  if to_regprocedure('public.mfa_ok()') is not null then
    execute 'drop policy if exists "two-step login" on public.e_invoices';
    execute 'create policy "two-step login" on public.e_invoices as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))';
  end if;
end $$;

create or replace function public.save_e_invoice(
  p_sale_id uuid, p_irn text, p_ack_no text default null, p_ack_date timestamptz default null, p_signed_qr text default null)
returns public.e_invoices language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_sale record;
  v_irn text := lower(trim(coalesce(p_irn, '')));
  v_row public.e_invoices;
begin
  if v_user is null then raise exception 'Please sign in again'; end if;
  if not (public.has_perm('reports') or public.has_perm('accounts')) then
    raise exception 'Your role doesn''t allow e-invoices';
  end if;
  select s.id, s.location_id, s.invoice_number, coalesce(s.status, 'completed') as status, c.gstin
    into v_sale from public.sales s left join public.customers c on c.id = s.customer_id where s.id = p_sale_id;
  if not found then raise exception 'Bill not found'; end if;
  if public.get_user_role(v_user) <> 'admin' and v_sale.location_id <> public.get_user_location(v_user) then
    raise exception 'This bill belongs to another store';
  end if;
  if v_sale.status = 'cancelled' then raise exception 'Bill % is cancelled', v_sale.invoice_number; end if;
  if coalesce(v_sale.gstin, '') = '' then raise exception 'Bill % has no customer GSTIN', v_sale.invoice_number; end if;
  if v_irn !~ '^[0-9a-f]{64}$' then raise exception 'The IRN should be 64 letters and numbers (0-9, a-f)'; end if;
  if exists (select 1 from public.e_invoices where sale_id = p_sale_id and status = 'active') then
    raise exception 'Bill % already has an IRN. Cancel it first.', v_sale.invoice_number;
  end if;
  if exists (select 1 from public.e_invoices where irn = v_irn) then
    raise exception 'This IRN is already saved on another bill';
  end if;

  insert into public.e_invoices (sale_id, location_id, irn, ack_no, ack_date, signed_qr, created_by)
  values (p_sale_id, v_sale.location_id, v_irn, nullif(trim(coalesce(p_ack_no, '')), ''), p_ack_date,
          nullif(trim(coalesce(p_signed_qr, '')), ''), v_user)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.cancel_e_invoice(p_sale_id uuid, p_reason text)
returns public.e_invoices language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_row public.e_invoices;
begin
  if v_user is null then raise exception 'Please sign in again'; end if;
  if not (public.has_perm('reports') or public.has_perm('accounts')) then
    raise exception 'Your role doesn''t allow e-invoices';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Write why it was cancelled'; end if;
  select * into v_row from public.e_invoices where sale_id = p_sale_id and status = 'active' for update;
  if not found then raise exception 'This bill has no active IRN'; end if;
  if public.get_user_role(v_user) <> 'admin' and v_row.location_id <> public.get_user_location(v_user) then
    raise exception 'This bill belongs to another store';
  end if;
  update public.e_invoices set status = 'cancelled', cancelled_at = now(), cancel_reason = trim(p_reason)
   where id = v_row.id returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.save_e_invoice(uuid, text, text, timestamptz, text) from public;
revoke all on function public.cancel_e_invoice(uuid, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.save_e_invoice(uuid, text, text, timestamptz, text) from anon';
    execute 'revoke all on function public.cancel_e_invoice(uuid, text) from anon';
  end if;
end $$;
grant execute on function public.save_e_invoice(uuid, text, text, timestamptz, text) to authenticated;
grant execute on function public.cancel_e_invoice(uuid, text) to authenticated;

-- record changes in the activity log, like other money records
do $$ begin
  if to_regprocedure('public.audit_row()') is not null then
    execute 'drop trigger if exists trg_audit_e_invoices on public.e_invoices';
    execute 'create trigger trg_audit_e_invoices after insert or update or delete on public.e_invoices for each row execute function public.audit_row()';
  end if;
end $$;

notify pgrst, 'reload schema';

-- =====================================================================
-- DailyKart: online catalogue
--   * a public page per store (/shop/<link name>) listing products with
--     price and "in stock / out of stock". Customers pick items and send
--     the order to the shop on WhatsApp. Off until the owner turns it on.
--   * products.show_online: hide single products from the catalogue.
--   * public_catalogue(link name): the only thing signed-out visitors can
--     read. It never shows cost prices, stock counts or other stores.
-- Only adds. Safe to run more than once.
-- =====================================================================

alter table public.locations add column if not exists catalogue_enabled boolean not null default false;
alter table public.locations add column if not exists catalogue_slug text;
alter table public.locations add column if not exists catalogue_whatsapp text;
alter table public.locations add column if not exists catalogue_note text;
alter table public.locations drop constraint if exists locations_catalogue_slug_ok;
alter table public.locations add constraint locations_catalogue_slug_ok
  check (catalogue_slug is null or catalogue_slug ~ '^[a-z0-9][a-z0-9-]{2,39}$');
create unique index if not exists uq_locations_catalogue_slug on public.locations(catalogue_slug) where catalogue_slug is not null;

alter table public.products add column if not exists show_online boolean not null default true;

create or replace function public.public_catalogue(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'store', jsonb_build_object(
      'name', coalesce(nullif(trim(l.business_name), ''), l.name),
      'address', l.address,
      'phone', l.phone,
      'whatsapp', coalesce(nullif(trim(l.catalogue_whatsapp), ''), l.phone),
      'note', l.catalogue_note),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'category', p.category,
               'price', round(p.price * (1 + coalesce(p.gst_rate, 0) / 100), 2),
               'mrp', p.mrp, 'image_url', p.image_url, 'sold_by', coalesce(p.sold_by, 'piece'),
               'in_stock', coalesce(p.stock_quantity, 0) > 0)
             order by p.category nulls last, p.name)
      from public.products p
      where p.location_id = l.id and coalesce(p.is_active, true) and p.show_online and coalesce(p.price, 0) > 0
    ), '[]'::jsonb))
  from public.locations l
  where l.catalogue_enabled and l.catalogue_slug = lower(trim(p_slug))
$$;
revoke all on function public.public_catalogue(text) from public;
grant execute on function public.public_catalogue(text) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.public_catalogue(text) to anon';
  end if;
end $$;

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
