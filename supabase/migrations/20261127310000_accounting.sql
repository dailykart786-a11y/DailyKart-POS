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
