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
