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
