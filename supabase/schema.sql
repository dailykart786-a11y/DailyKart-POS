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
