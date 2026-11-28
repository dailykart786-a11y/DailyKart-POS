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
