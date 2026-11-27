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
