-- 1) Create locations table
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  address text,
  created_at timestamptz not null default now()
);

alter table public.locations enable row level security;

-- Policies for locations
create policy if not exists "Authenticated can view locations"
  on public.locations
  for select
  to authenticated
  using (auth.role() = 'authenticated');

create policy if not exists "Admins manage locations"
  on public.locations
  for all
  to authenticated
  using (public.get_user_role(auth.uid()) = 'admin')
  with check (public.get_user_role(auth.uid()) = 'admin');

-- 2) Create user_location_assignments (single location per user)
create table if not exists public.user_location_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id)
);

alter table public.user_location_assignments enable row level security;

create policy if not exists "Admins manage user locations"
  on public.user_location_assignments
  for all
  to authenticated
  using (public.get_user_role(auth.uid()) = 'admin')
  with check (public.get_user_role(auth.uid()) = 'admin');

create policy if not exists "Users view own location assignment"
  on public.user_location_assignments
  for select
  to authenticated
  using (auth.uid() = user_id);

-- 3) Helper functions for default location and fetching a user's location
create or replace function public.default_location()
returns uuid
language sql
stable
as $$
  select id from public.locations where name = 'Default Store' limit 1
$$;

create or replace function public.get_user_location(user_uuid uuid)
returns uuid
language sql
stable
security definer
as $$
  select ula.location_id
  from public.user_location_assignments ula
  where ula.user_id = user_uuid
  limit 1
$$;

-- 4) Seed a default location if it doesn't exist
insert into public.locations (name, address)
values ('Default Store', null)
on conflict (name) do nothing;

-- 5) Add location_id to main business tables and backfill with default
-- Products
alter table public.products
  add column if not exists location_id uuid not null default public.default_location();
alter table public.products
  add constraint products_location_fk foreign key (location_id) references public.locations(id) on delete restrict;
create index if not exists idx_products_location on public.products(location_id);

-- Sales
alter table public.sales
  add column if not exists location_id uuid not null default public.default_location();
alter table public.sales
  add constraint sales_location_fk foreign key (location_id) references public.locations(id) on delete restrict;
create index if not exists idx_sales_location on public.sales(location_id);

-- Customers
alter table public.customers
  add column if not exists location_id uuid not null default public.default_location();
alter table public.customers
  add constraint customers_location_fk foreign key (location_id) references public.locations(id) on delete restrict;
create index if not exists idx_customers_location on public.customers(location_id);

-- Expenses
alter table public.expenses
  add column if not exists location_id uuid not null default public.default_location();
alter table public.expenses
  add constraint expenses_location_fk foreign key (location_id) references public.locations(id) on delete restrict;
create index if not exists idx_expenses_location on public.expenses(location_id);

-- Suppliers
alter table public.suppliers
  add column if not exists location_id uuid not null default public.default_location();
alter table public.suppliers
  add constraint suppliers_location_fk foreign key (location_id) references public.locations(id) on delete restrict;
create index if not exists idx_suppliers_location on public.suppliers(location_id);

-- 6) Backfill user assignments: assign all existing users to Default Store if not already assigned
insert into public.user_location_assignments (user_id, location_id)
select u.id, public.default_location()
from auth.users u
left join public.user_location_assignments ula on ula.user_id = u.id
where ula.user_id is null;

-- 7) Replace RLS policies on scoped tables with location-aware ones
-- PRODUCTS: drop existing
drop policy if exists "Authenticated users can view products" on public.products;
drop policy if exists "Authenticated users can insert products" on public.products;
drop policy if exists "Authenticated users can update products" on public.products;
drop policy if exists "Authenticated users can delete products" on public.products;

-- PRODUCTS: create new
create policy "Location scoped select on products"
  on public.products for select to authenticated
  using (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  );

create policy "Location scoped insert on products"
  on public.products for insert to authenticated
  with check (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  );

create policy "Location scoped update on products"
  on public.products for update to authenticated
  using (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  )
  with check (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  );

create policy "Location scoped delete on products"
  on public.products for delete to authenticated
  using (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  );

-- CUSTOMERS: drop existing
drop policy if exists "Authenticated users can view customers" on public.customers;
drop policy if exists "Authenticated users can insert customers" on public.customers;
drop policy if exists "Authenticated users can update customers" on public.customers;
drop policy if exists "Authenticated users can delete customers" on public.customers;

-- CUSTOMERS: create new
create policy "Location scoped select on customers"
  on public.customers for select to authenticated
  using (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  );

create policy "Location scoped insert on customers"
  on public.customers for insert to authenticated
  with check (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  );

create policy "Location scoped update on customers"
  on public.customers for update to authenticated
  using (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  )
  with check (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  );

create policy "Location scoped delete on customers"
  on public.customers for delete to authenticated
  using (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  );

-- EXPENSES: drop existing
drop policy if exists "Authenticated users can view expenses" on public.expenses;
drop policy if exists "Authenticated users can insert expenses" on public.expenses;
drop policy if exists "Authenticated users can update expenses" on public.expenses;

-- EXPENSES: create new (no delete policy previously)
create policy "Location scoped select on expenses"
  on public.expenses for select to authenticated
  using (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  );

create policy "Location scoped insert on expenses"
  on public.expenses for insert to authenticated
  with check (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  );

create policy "Location scoped update on expenses"
  on public.expenses for update to authenticated
  using (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  )
  with check (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  );

-- SUPPLIERS: drop existing
drop policy if exists "Authenticated users can view suppliers" on public.suppliers;
drop policy if exists "Authenticated users can insert suppliers" on public.suppliers;
drop policy if exists "Authenticated users can update suppliers" on public.suppliers;

-- SUPPLIERS: create new (no delete policy previously)
create policy "Location scoped select on suppliers"
  on public.suppliers for select to authenticated
  using (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  );

create policy "Location scoped insert on suppliers"
  on public.suppliers for insert to authenticated
  with check (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  );

create policy "Location scoped update on suppliers"
  on public.suppliers for update to authenticated
  using (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  )
  with check (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  );

-- SALES: drop existing
drop policy if exists "Authenticated users can view sales" on public.sales;
drop policy if exists "Authenticated users can insert sales" on public.sales;
drop policy if exists "Authenticated users can update sales" on public.sales;

-- SALES: create new (no delete policy previously)
create policy "Location scoped select on sales"
  on public.sales for select to authenticated
  using (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  );

create policy "Location scoped insert on sales"
  on public.sales for insert to authenticated
  with check (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  );

create policy "Location scoped update on sales"
  on public.sales for update to authenticated
  using (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  )
  with check (
    public.get_user_role(auth.uid()) = 'admin'
    or location_id = public.get_user_location(auth.uid())
  );

-- SALE_ITEMS: drop existing
drop policy if exists "Authenticated users can view sale items" on public.sale_items;
drop policy if exists "Authenticated users can insert sale items" on public.sale_items;
drop policy if exists "Authenticated users can update sale items" on public.sale_items;

-- SALE_ITEMS: create new (no delete policy previously)
create policy "Location scoped select on sale_items"
  on public.sale_items for select to authenticated
  using (
    public.get_user_role(auth.uid()) = 'admin'
    or exists (
      select 1 from public.sales s
      where s.id = sale_id
        and s.location_id = public.get_user_location(auth.uid())
    )
  );

create policy "Location scoped insert on sale_items"
  on public.sale_items for insert to authenticated
  with check (
    public.get_user_role(auth.uid()) = 'admin'
    or exists (
      select 1 from public.sales s
      where s.id = sale_id
        and s.location_id = public.get_user_location(auth.uid())
    )
  );

create policy "Location scoped update on sale_items"
  on public.sale_items for update to authenticated
  using (
    public.get_user_role(auth.uid()) = 'admin'
    or exists (
      select 1 from public.sales s
      where s.id = sale_id
        and s.location_id = public.get_user_location(auth.uid())
    )
  )
  with check (
    public.get_user_role(auth.uid()) = 'admin'
    or exists (
      select 1 from public.sales s
      where s.id = sale_id
        and s.location_id = public.get_user_location(auth.uid())
    )
  );
