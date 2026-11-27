-- =====================================================================
-- DailyKart: Reports Phase 5 — khata (udhaar) ageing, khata statement,
-- payment register and register (day closing) variance.
--   * report_khata_ageing(store, search, bucket, sort, dir, limit, offset):
--     what each customer owes now, split by how old the unpaid bills are
--     (0–7, 8–15, 16–30, 31–60, over 60 days) and what is past their
--     credit days. Payments clear the oldest bill first, the same rule the
--     Khata page uses, so the totals equal customer_balances.
--   * report_khata_statement(customer, from, to): opening balance, every
--     udhaar bill, payment and khata refund in the dates with a running
--     balance, and the closing balance.
--   * report_payment_register(from, to, store, method, kind, search, ...):
--     every rupee in and out: bill payments (split bills per part), khata
--     payments, refunds, supplier payments and expenses, by method.
--   * report_registers(from, to, store, ...): each register session with
--     expected and counted cash (and UPI/card where counted), short/over.
--   * report_purchases: supplier payments that were reversed are no longer
--     counted as paid (fix to the Phase 4 function).
-- Read-only: nothing is stored and no bill is changed. Runs with the
-- caller's own access (row level security applies), needs the Reports
-- permission. India days. Safe to run more than once.
-- =====================================================================

-- ---------- Khata ageing, one page of customers at a time
-- bucket: all | d0_7 | d8_15 | d16_30 | d31_60 | d60_plus | overdue | over_limit | advance
--         (a customer is in a bucket when their OLDEST unpaid amount is that old)
-- sort: due | age | overdue | name | last_payment ; dir: desc | asc
create or replace function public.report_khata_ageing(
  p_location_id uuid default null, p_search text default null, p_bucket text default 'all',
  p_sort text default 'due', p_dir text default 'desc',
  p_limit integer default 25, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(trim(coalesce(p_search, '')), '');
  v_bucket text := lower(coalesce(p_bucket, 'all'));
  v_sort text := lower(coalesce(p_sort, 'due'));
  v_asc boolean := lower(coalesce(p_dir, 'desc')) = 'asc';
  v_out jsonb;
begin
  if not public.has_perm('reports') then
    raise exception 'Your role doesn''t allow reports';
  end if;
  if v_bucket not in ('all', 'd0_7', 'd8_15', 'd16_30', 'd31_60', 'd60_plus', 'overdue', 'over_limit', 'advance') then
    raise exception 'Unknown ageing filter: %', p_bucket;
  end if;

  with c as (
    select c.id, c.name, c.phone, c.created_at, c.opening_balance, c.credit_limit, c.credit_days, c.customer_group
    from public.customers c
    where (p_location_id is null or c.location_id = p_location_id)
  ), debits as (
    -- what was put on khata: positive opening balance and the udhaar part of each bill
    select c.id as customer_id, c.created_at as at, 0 as k, greatest(c.opening_balance, 0) as amt
    from c where c.opening_balance > 0
    union all
    select s.customer_id, s.created_at, 1,
           coalesce(s.credit_amount, case when s.payment_method = 'credit' then s.total_amount else 0 end)
    from public.sales s
    join c on c.id = s.customer_id
    where (s.payment_method = 'credit' or s.credit_amount > 0)
      and coalesce(s.status, 'completed') <> 'cancelled'
  ), credits as (
    select c.id as customer_id,
           greatest(-c.opening_balance, 0)
           + coalesce((select sum(p.amount) from public.customer_payments p where p.customer_id = c.id and p.reversed_at is null), 0)
           + coalesce((select sum(r.refund_amount) from public.sale_returns r where r.customer_id = c.id and r.refund_method = 'khata'), 0) as paid,
           (select max(p.created_at) from public.customer_payments p where p.customer_id = c.id and p.reversed_at is null) as last_payment_at
    from c
  ), open_debits as (
    -- payments clear the oldest first: what is left of each debit
    select d.customer_id, d.at,
           least(d.amt, greatest(d.cum - cr.paid, 0)) as left_amt
    from (select d.*, sum(d.amt) over (partition by d.customer_id order by d.at, d.k rows unbounded preceding) as cum
          from debits d where d.amt > 0) d
    join credits cr on cr.customer_id = d.customer_id
  ), aged as (
    select o.customer_id, o.at, o.left_amt,
           v_today - (o.at at time zone 'Asia/Kolkata')::date as age
    from open_debits o where o.left_amt > 0.004
  ), per as (
    select c.id, c.name, c.phone, c.customer_group, c.credit_limit, c.credit_days,
           coalesce((select sum(d.amt) from debits d where d.customer_id = c.id), 0) - cr.paid as balance,
           cr.last_payment_at,
           coalesce(sum(a.left_amt) filter (where a.age <= 7), 0) as d0_7,
           coalesce(sum(a.left_amt) filter (where a.age between 8 and 15), 0) as d8_15,
           coalesce(sum(a.left_amt) filter (where a.age between 16 and 30), 0) as d16_30,
           coalesce(sum(a.left_amt) filter (where a.age between 31 and 60), 0) as d31_60,
           coalesce(sum(a.left_amt) filter (where a.age > 60), 0) as d60_plus,
           coalesce(sum(a.left_amt) filter (where c.credit_days is not null and a.age > c.credit_days), 0) as overdue,
           max(a.age) as oldest_age,
           min(a.at) as oldest_due_at
    from c
    join credits cr on cr.customer_id = c.id
    left join aged a on a.customer_id = c.id
    group by c.id, c.name, c.phone, c.customer_group, c.credit_limit, c.credit_days, cr.paid, cr.last_payment_at
  ), f as (
    select p.*,
           case when p.balance <= 0.004 then null
                when p.oldest_age <= 7 then 'd0_7' when p.oldest_age <= 15 then 'd8_15' when p.oldest_age <= 30 then 'd16_30'
                when p.oldest_age <= 60 then 'd31_60' else 'd60_plus' end as bucket
    from per p
    where (v_q is null or p.name ilike '%' || v_q || '%' or p.phone ilike '%' || v_q || '%')
  ), sel as (
    select * from f
    where case v_bucket
            when 'all' then f.balance > 0.004
            when 'overdue' then f.overdue > 0.004
            when 'over_limit' then f.credit_limit is not null and f.balance > f.credit_limit + 0.004
            when 'advance' then f.balance < -0.004
            else f.bucket = v_bucket end
  )
  select jsonb_build_object(
    'as_of', v_today,
    'total', (select count(*) from sel),
    'totals', (select jsonb_build_object(
        'customers_owing', count(*) filter (where balance > 0.004),
        'outstanding', round(coalesce(sum(balance) filter (where balance > 0.004), 0), 2),
        'advance', round(coalesce(-sum(balance) filter (where balance < -0.004), 0), 2),
        'customers_advance', count(*) filter (where balance < -0.004),
        'd0_7', round(coalesce(sum(d0_7), 0), 2), 'd8_15', round(coalesce(sum(d8_15), 0), 2),
        'd16_30', round(coalesce(sum(d16_30), 0), 2), 'd31_60', round(coalesce(sum(d31_60), 0), 2),
        'd60_plus', round(coalesce(sum(d60_plus), 0), 2),
        'overdue', round(coalesce(sum(overdue), 0), 2),
        'customers_overdue', count(*) filter (where overdue > 0.004),
        'over_limit', count(*) filter (where credit_limit is not null and balance > credit_limit + 0.004))
      from f),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(t) - 'ord') from (
        select s.id as customer_id, s.name, s.phone, s.customer_group, round(s.balance, 2) as balance,
               round(s.d0_7, 2) as d0_7, round(s.d8_15, 2) as d8_15, round(s.d16_30, 2) as d16_30,
               round(s.d31_60, 2) as d31_60, round(s.d60_plus, 2) as d60_plus, round(s.overdue, 2) as overdue,
               s.oldest_age, s.oldest_due_at, s.bucket, s.credit_limit, s.credit_days, s.last_payment_at,
               case when s.last_payment_at is not null then v_today - (s.last_payment_at at time zone 'Asia/Kolkata')::date end as days_since_payment,
               row_number() over (order by
                 case when not v_asc then
                   case v_sort when 'age' then s.oldest_age::numeric when 'overdue' then s.overdue
                     when 'last_payment' then extract(epoch from s.last_payment_at)::numeric else abs(s.balance) end end desc nulls last,
                 case when v_asc then
                   case v_sort when 'age' then s.oldest_age::numeric when 'overdue' then s.overdue
                     when 'last_payment' then extract(epoch from s.last_payment_at)::numeric else abs(s.balance) end end asc nulls first,
                 case when v_sort = 'name' and not v_asc then s.name end desc,
                 s.name, s.id) as ord
        from sel s
        order by ord
        limit v_limit offset v_offset
      ) t), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

-- ---------- One customer's khata in the dates, with a running balance
create or replace function public.report_khata_statement(
  p_customer_id uuid, p_from date, p_to date, p_limit integer default 500
) returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_from date := least(p_from, p_to);
  v_to date := greatest(p_from, p_to);
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_c record;
  v_out jsonb;
begin
  if not public.has_perm('reports') then
    raise exception 'Your role doesn''t allow reports';
  end if;
  select id, name, phone, opening_balance, credit_limit, credit_days, created_at into v_c
  from public.customers where id = p_customer_id;
  if not found then raise exception 'Customer not found'; end if;
  v_t0 := v_from::timestamp at time zone 'Asia/Kolkata';
  v_t1 := (v_to + 1)::timestamp at time zone 'Asia/Kolkata';

  with e as (
    select v_c.created_at as at, 'opening' as kind, null::text as ref, null::text as method,
           v_c.opening_balance as amount, 'Opening balance' as note, null::uuid as ref_id
    where v_c.opening_balance <> 0
    union all
    select s.created_at, 'udhaar', s.invoice_number, s.payment_method,
           coalesce(s.credit_amount, case when s.payment_method = 'credit' then s.total_amount else 0 end),
           case when s.payment_method = 'split' then 'Part of bill ₹' || s.total_amount::text else null end, s.id
    from public.sales s
    where s.customer_id = v_c.id and (s.payment_method = 'credit' or s.credit_amount > 0)
      and coalesce(s.status, 'completed') <> 'cancelled'
    union all
    select p.created_at, 'payment', null, p.method, -p.amount, p.note, p.id
    from public.customer_payments p
    where p.customer_id = v_c.id and p.reversed_at is null
    union all
    select r.created_at, 'refund', r.return_number, 'khata', -r.refund_amount, r.reason, r.id
    from public.sale_returns r
    where r.customer_id = v_c.id and r.refund_method = 'khata'
  ), ordered as (
    select e.*, sum(e.amount) over (order by e.at, e.kind rows unbounded preceding) as running
    from e where e.amount <> 0
  )
  select jsonb_build_object(
    'customer', jsonb_build_object('customer_id', v_c.id, 'name', v_c.name, 'phone', v_c.phone,
                                   'credit_limit', v_c.credit_limit, 'credit_days', v_c.credit_days),
    'from', v_from, 'to', v_to,
    'opening', round(coalesce((select sum(amount) from ordered where at < v_t0), 0), 2),
    'udhaar', round(coalesce((select sum(amount) from ordered where at >= v_t0 and at < v_t1 and amount > 0), 0), 2),
    'received', round(coalesce((select -sum(amount) from ordered where at >= v_t0 and at < v_t1 and amount < 0), 0), 2),
    'closing', round(coalesce((select sum(amount) from ordered where at < v_t1), 0), 2),
    'balance_now', round(coalesce((select sum(amount) from ordered), 0), 2),
    'total', (select count(*) from ordered where at >= v_t0 and at < v_t1),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select o.at, o.kind, o.ref, o.ref_id, o.method, round(o.amount, 2) as amount, o.note, round(o.running, 2) as running
        from ordered o where o.at >= v_t0 and o.at < v_t1
        order by o.at, o.kind
        limit v_limit
      ) t), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

-- ---------- Every rupee in and out in the dates
-- method: null (all) | cash | upi | card | bank | cheque
-- kind:   null (all) | bill | khata | refund | supplier | expense
-- Udhaar given on bills and khata refunds are not money and are not listed;
-- the udhaar total is returned separately.
create or replace function public.report_payment_register(
  p_from date, p_to date, p_location_id uuid default null,
  p_method text default null, p_kind text default null, p_search text default null,
  p_limit integer default 25, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_from date := least(p_from, p_to);
  v_to date := greatest(p_from, p_to);
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(trim(coalesce(p_search, '')), '');
  v_method text := nullif(lower(trim(coalesce(p_method, ''))), '');
  v_kind text := nullif(lower(trim(coalesce(p_kind, ''))), '');
  v_out jsonb;
begin
  if not public.has_perm('reports') then
    raise exception 'Your role doesn''t allow reports';
  end if;
  if v_from < v_to - 400 then
    raise exception 'Pick at most about 13 months for the payment register';
  end if;
  v_t0 := v_from::timestamp at time zone 'Asia/Kolkata';
  v_t1 := (v_to + 1)::timestamp at time zone 'Asia/Kolkata';

  with s as (
    select x.id, x.created_at, x.invoice_number, x.total_amount, x.payment_method, x.payment_split, x.credit_amount,
           x.customer_id, x.cashier_id
    from public.sales x
    where x.created_at >= v_t0 and x.created_at < v_t1
      and coalesce(x.status, 'completed') <> 'cancelled'
      and (p_location_id is null or x.location_id = p_location_id)
  ), ev as (
    -- bill payments; a split bill gives one line per part
    select s.created_at as at, 'bill' as kind,
           case when s.payment_method = 'split' then kv.key else coalesce(s.payment_method, 'cash') end as method,
           case when s.payment_method = 'split' then kv.value::text::numeric else s.total_amount end as amount,
           s.invoice_number as ref, s.id as ref_id, s.customer_id as party_id, 'customer' as party_type, s.cashier_id as by_id
    from s
    left join lateral jsonb_each(case when s.payment_method = 'split' then s.payment_split else null end) kv on true
    where s.payment_method <> 'split' or kv.key is not null
    union all
    select p.created_at, 'khata', p.method, p.amount, null, p.id, p.customer_id, 'customer', p.created_by
    from public.customer_payments p
    where p.created_at >= v_t0 and p.created_at < v_t1 and p.reversed_at is null
      and (p_location_id is null or p.location_id = p_location_id)
    union all
    select r.created_at, 'refund', r.refund_method, -r.refund_amount, r.return_number, r.id, r.customer_id, 'customer', r.created_by
    from public.sale_returns r
    where r.created_at >= v_t0 and r.created_at < v_t1 and r.refund_method <> 'khata'
      and (p_location_id is null or r.location_id = p_location_id)
    union all
    select sp.created_at, 'supplier', sp.method, -sp.amount, null, sp.id, sp.supplier_id, 'supplier', sp.created_by
    from public.supplier_payments sp
    where sp.created_at >= v_t0 and sp.created_at < v_t1 and sp.reversed_at is null
      and (p_location_id is null or sp.location_id = p_location_id)
    union all
    select e.created_at, 'expense', e.payment_method, -e.amount, e.category, e.id, null, null, e.created_by
    from public.expenses e
    where e.created_at >= v_t0 and e.created_at < v_t1 and coalesce(e.status, 'approved') <> 'rejected'
      and (p_location_id is null or e.location_id = p_location_id)
  ), money as (
    select ev.*,
           case ev.party_type when 'customer' then (select c.name from public.customers c where c.id = ev.party_id)
                              when 'supplier' then (select su.name from public.suppliers su where su.id = ev.party_id) end as party
    from ev where ev.method <> 'credit' and ev.amount <> 0
  ), f as (
    select * from money m
    where (v_method is null or m.method = v_method)
      and (v_kind is null or m.kind = v_kind)
      and (v_q is null or m.ref ilike '%' || v_q || '%' or m.party ilike '%' || v_q || '%')
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'udhaar_given', (select round(coalesce(sum(coalesce(s.credit_amount, case when s.payment_method = 'credit' then s.total_amount else 0 end)), 0), 2)
                     from s where s.payment_method = 'credit' or s.credit_amount > 0),
    'khata_refunds', (select round(coalesce(sum(r.refund_amount), 0), 2) from public.sale_returns r
                      where r.created_at >= v_t0 and r.created_at < v_t1 and r.refund_method = 'khata'
                        and (p_location_id is null or r.location_id = p_location_id)),
    'by_method', coalesce((
      select jsonb_agg(jsonb_build_object('key', method, 'money_in', round(i, 2), 'money_out', round(o, 2), 'net', round(i - o, 2), 'entries', n)
                       order by i - o desc)
      from (select method, coalesce(sum(amount) filter (where amount > 0), 0) as i, coalesce(-sum(amount) filter (where amount < 0), 0) as o, count(*) as n
            from money group by method) z), '[]'::jsonb),
    'by_kind', coalesce((
      select jsonb_agg(jsonb_build_object('key', kind, 'amount', round(a, 2), 'entries', n) order by a desc)
      from (select kind, sum(amount) as a, count(*) as n from money group by kind) z), '[]'::jsonb),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', d, 'money_in', round(i, 2), 'money_out', round(o, 2), 'cash_net', round(cn, 2)) order by d)
      from (select (at at time zone 'Asia/Kolkata')::date::text as d,
                   coalesce(sum(amount) filter (where amount > 0), 0) as i,
                   coalesce(-sum(amount) filter (where amount < 0), 0) as o,
                   coalesce(sum(amount) filter (where method = 'cash'), 0) as cn
            from money group by 1) z), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select f.at, f.kind, f.method, round(f.amount, 2) as amount, f.ref, f.ref_id, f.party,
               (select pr.full_name from public.profiles pr where pr.id = f.by_id) as by_name
        from f
        order by f.at desc, f.ref_id
        limit v_limit offset v_offset
      ) t), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

-- ---------- Register sessions (day closing): expected vs counted
-- Sessions opened in the dates. Open sessions are listed without a difference.
create or replace function public.report_registers(
  p_from date, p_to date, p_location_id uuid default null,
  p_limit integer default 25, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_from date := least(p_from, p_to);
  v_to date := greatest(p_from, p_to);
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_out jsonb;
begin
  if not public.has_perm('reports') then
    raise exception 'Your role doesn''t allow reports';
  end if;
  v_t0 := v_from::timestamp at time zone 'Asia/Kolkata';
  v_t1 := (v_to + 1)::timestamp at time zone 'Asia/Kolkata';

  with r as (
    select rs.*, (select pr.full_name from public.profiles pr where pr.id = rs.user_id) as cashier,
           nullif(rs.closing_breakdown->'methods'->'upi'->>'difference', '')::numeric as upi_diff,
           nullif(rs.closing_breakdown->'methods'->'card'->>'difference', '')::numeric as card_diff,
           nullif(rs.closing_breakdown->'methods'->'upi'->>'expected', '')::numeric as upi_expected,
           nullif(rs.closing_breakdown->'methods'->'upi'->>'counted', '')::numeric as upi_counted,
           nullif(rs.closing_breakdown->'methods'->'card'->>'expected', '')::numeric as card_expected,
           nullif(rs.closing_breakdown->'methods'->'card'->>'counted', '')::numeric as card_counted
    from public.register_sessions rs
    where rs.opened_at >= v_t0 and rs.opened_at < v_t1
      and (p_location_id is null or rs.location_id = p_location_id)
  )
  select jsonb_build_object(
    'total', (select count(*) from r),
    'totals', (select jsonb_build_object(
        'sessions', count(*), 'closed', count(*) filter (where closed_at is not null),
        'open', count(*) filter (where closed_at is null),
        'short', round(coalesce(-sum(difference) filter (where difference < 0), 0), 2),
        'over', round(coalesce(sum(difference) filter (where difference > 0), 0), 2),
        'net', round(coalesce(sum(difference), 0), 2),
        'short_count', count(*) filter (where difference < -0.004),
        'over_count', count(*) filter (where difference > 0.004),
        'exact_count', count(*) filter (where closed_at is not null and abs(coalesce(difference, 0)) <= 0.004),
        'upi_diff', round(coalesce(sum(upi_diff), 0), 2), 'card_diff', round(coalesce(sum(card_diff), 0), 2),
        'expected_cash', round(coalesce(sum(expected_cash), 0), 2), 'counted_cash', round(coalesce(sum(counted_cash), 0), 2))
      from r),
    'by_cashier', coalesce((
      select jsonb_agg(jsonb_build_object('key', user_id, 'label', coalesce(cashier, 'Unknown'), 'sessions', n, 'short', round(sh, 2),
                                          'over', round(ov, 2), 'net', round(nt, 2), 'short_count', sc) order by sh desc)
      from (select user_id, min(cashier) as cashier, count(*) as n,
                   coalesce(-sum(difference) filter (where difference < 0), 0) as sh,
                   coalesce(sum(difference) filter (where difference > 0), 0) as ov,
                   coalesce(sum(difference), 0) as nt,
                   count(*) filter (where difference < -0.004) as sc
            from r group by user_id) z), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select r.id, r.user_id, r.cashier, r.opened_at, r.closed_at, r.opening_cash, r.expected_cash, r.counted_cash, r.difference,
               r.upi_expected, r.upi_counted, r.upi_diff, r.card_expected, r.card_counted, r.card_diff, r.note,
               coalesce((r.totals->>'bills')::numeric, null) as bills,
               coalesce((r.totals->>'total_sales')::numeric, null) as total_sales,
               coalesce((r.totals->>'cash_sales')::numeric, null) as cash_sales
        from r
        order by r.opened_at desc, r.id
        limit v_limit offset v_offset
      ) t), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

-- ---------- Purchases in the dates (supplier bill date), grouped
-- by: supplier | product | category | bill ; sort is fixed per grouping (largest first, bills newest first)
-- Line value is ex-GST (total - GST); the line quantity includes free pieces.
create or replace function public.report_purchases(
  p_from date, p_to date, p_location_id uuid default null,
  p_by text default 'supplier', p_search text default null,
  p_limit integer default 25, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_from date := least(p_from, p_to);
  v_to date := greatest(p_from, p_to);
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_by text := lower(coalesce(p_by, 'supplier'));
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(trim(coalesce(p_search, '')), '');
  v_rows jsonb;
  v_total bigint;
  v_totals jsonb;
begin
  if not public.has_perm('reports') then
    raise exception 'Your role doesn''t allow reports';
  end if;
  if v_by not in ('supplier', 'product', 'category', 'bill') then
    raise exception 'Unknown grouping: %', p_by;
  end if;
  v_t0 := v_from::timestamp at time zone 'Asia/Kolkata';
  v_t1 := (v_to + 1)::timestamp at time zone 'Asia/Kolkata';

  -- Bill totals: the same numbers as the Profit & loss purchases lines
  select jsonb_build_object(
           'bills', count(*), 'taxable', round(coalesce(sum(taxable_amount), 0), 2),
           'tax', round(coalesce(sum(tax_amount), 0), 2), 'total', round(coalesce(sum(total_amount), 0), 2),
           'suppliers', count(distinct supplier_id),
           'returns_total', (select round(coalesce(sum(total_amount), 0), 2) from public.purchase_returns r
                             where r.created_at >= v_t0 and r.created_at < v_t1
                               and (p_location_id is null or r.location_id = p_location_id)),
           'paid', (select round(coalesce(sum(amount), 0), 2) from public.supplier_payments sp
                    where sp.created_at >= v_t0 and sp.created_at < v_t1 and sp.reversed_at is null
                      and (p_location_id is null or sp.location_id = p_location_id)))
    into v_totals
  from public.purchases
  where bill_date between v_from and v_to
    and (p_location_id is null or location_id = p_location_id);

  if v_by in ('supplier', 'bill') then
    with pu as (
      select pu.*, s.name as supplier_name
      from public.purchases pu
      join public.suppliers s on s.id = pu.supplier_id
      where pu.bill_date between v_from and v_to
        and (p_location_id is null or pu.location_id = p_location_id)
        and (v_q is null or s.name ilike '%' || v_q || '%' or pu.bill_number ilike '%' || v_q || '%')
    ), sup as (
      select pu.supplier_id, min(pu.supplier_name) as name, count(*) as bills,
             sum(pu.taxable_amount) as taxable, sum(pu.tax_amount) as tax, sum(pu.total_amount) as total,
             max(pu.bill_date) as last_bill_date
      from pu group by pu.supplier_id
    ), sret as (
      select r.supplier_id, sum(r.total_amount) as total
      from public.purchase_returns r
      where r.created_at >= v_t0 and r.created_at < v_t1
        and (p_location_id is null or r.location_id = p_location_id)
      group by r.supplier_id
    ), spay as (
      select sp.supplier_id, sum(sp.amount) as paid
      from public.supplier_payments sp
      where sp.created_at >= v_t0 and sp.created_at < v_t1 and sp.reversed_at is null
        and (p_location_id is null or sp.location_id = p_location_id)
      group by sp.supplier_id
    )
    select case when v_by = 'supplier' then (select count(*) from sup) else (select count(*) from pu) end,
           case when v_by = 'supplier' then coalesce((
             select jsonb_agg(to_jsonb(t)) from (
               select s.supplier_id as key, s.name as label, s.bills, round(s.taxable, 2) as taxable, round(s.tax, 2) as tax,
                      round(s.total, 2) as total, round(coalesce(r.total, 0), 2) as returns_total,
                      round(s.total - coalesce(r.total, 0), 2) as net_total, round(coalesce(pay.paid, 0), 2) as paid,
                      (select round(b.balance, 2) from public.supplier_balances b where b.supplier_id = s.supplier_id) as balance_now,
                      s.last_bill_date
               from sup s
               left join sret r on r.supplier_id = s.supplier_id
               left join spay pay on pay.supplier_id = s.supplier_id
               order by s.total desc, s.name
               limit v_limit offset v_offset) t), '[]'::jsonb)
           else coalesce((
             select jsonb_agg(to_jsonb(t)) from (
               select pu.id as key, pu.bill_date, pu.bill_number, pu.supplier_id, pu.supplier_name as label,
                      (select count(*) from public.purchase_items i where i.purchase_id = pu.id) as lines,
                      round(pu.taxable_amount, 2) as taxable, round(pu.tax_amount, 2) as tax, round(pu.total_amount, 2) as total
               from pu
               order by pu.bill_date desc, pu.created_at desc, pu.id
               limit v_limit offset v_offset) t), '[]'::jsonb)
           end
      into v_total, v_rows;
  else
    with li as (
      select i.product_id, p.name, p.sku, p.category, p.cost_price as cost_now, pu.bill_date, pu.created_at,
             i.quantity, coalesce(i.free_quantity, 0) as free_qty, coalesce(i.damaged_quantity, 0) as damaged_qty,
             i.unit_cost, i.total - coalesce(i.gst_amount, 0) as taxable, coalesce(i.gst_amount, 0) as gst, i.total
      from public.purchase_items i
      join public.purchases pu on pu.id = i.purchase_id
      join public.products p on p.id = i.product_id
      where pu.bill_date between v_from and v_to
        and (p_location_id is null or pu.location_id = p_location_id)
        and (v_q is null or p.name ilike '%' || v_q || '%' or p.sku ilike v_q || '%' or p.barcode = v_q
             or coalesce(p.category, '') ilike '%' || v_q || '%')
    ), prod as (
      select li.product_id, min(li.name) as name, min(li.sku) as sku, min(li.category) as category, min(li.cost_now) as cost_now,
             count(*) as lines, sum(li.quantity) as qty, sum(li.free_qty) as free_qty, sum(li.damaged_qty) as damaged_qty,
             sum(li.taxable) as taxable, sum(li.gst) as gst, sum(li.total) as total,
             min(li.unit_cost) as min_cost, max(li.unit_cost) as max_cost,
             (array_agg(li.unit_cost order by li.bill_date, li.created_at))[1] as first_cost,
             (array_agg(li.unit_cost order by li.bill_date desc, li.created_at desc))[1] as last_cost,
             max(li.bill_date) as last_bill_date
      from li group by li.product_id
    ), cat as (
      select coalesce(category, '') as key, coalesce(nullif(category, ''), 'No category') as label,
             count(*) as products, sum(lines) as lines, sum(qty) as qty, sum(free_qty) as free_qty,
             sum(taxable) as taxable, sum(gst) as gst, sum(total) as total
      from prod group by coalesce(category, ''), coalesce(nullif(category, ''), 'No category')
    )
    select case when v_by = 'product' then (select count(*) from prod) else (select count(*) from cat) end,
           case when v_by = 'product' then coalesce((
             select jsonb_agg(to_jsonb(t)) from (
               select pr.product_id as key, pr.name as label, pr.sku, pr.category, pr.lines,
                      round(pr.qty, 3) as qty, round(pr.free_qty, 3) as free_qty, round(pr.damaged_qty, 3) as damaged_qty,
                      round(pr.taxable, 2) as taxable, round(pr.gst, 2) as tax, round(pr.total, 2) as total,
                      case when pr.qty - pr.free_qty > 0 then round(pr.taxable / (pr.qty - pr.free_qty), 2) end as avg_cost,
                      case when pr.qty > 0 then round(pr.taxable / pr.qty, 2) end as cost_per_piece,
                      pr.min_cost, pr.max_cost, pr.first_cost, pr.last_cost, pr.cost_now,
                      case when pr.first_cost > 0 then round((pr.last_cost - pr.first_cost) * 100 / pr.first_cost, 2) end as cost_change_pct,
                      pr.last_bill_date
               from prod pr
               order by pr.total desc, pr.name
               limit v_limit offset v_offset) t), '[]'::jsonb)
           else coalesce((
             select jsonb_agg(to_jsonb(t)) from (
               select c.key, c.label, c.products, c.lines, round(c.qty, 3) as qty, round(c.free_qty, 3) as free_qty,
                      round(c.taxable, 2) as taxable, round(c.gst, 2) as tax, round(c.total, 2) as total
               from cat c
               order by c.total desc, c.label
               limit v_limit offset v_offset) t), '[]'::jsonb)
           end
      into v_total, v_rows;
    -- line totals for this grouping (may differ from bill totals by paisa rounding on old bills)
    v_totals := v_totals || (
      select jsonb_build_object('lines_taxable', round(coalesce(sum(i.total - coalesce(i.gst_amount, 0)), 0), 2),
                                'lines_tax', round(coalesce(sum(i.gst_amount), 0), 2),
                                'lines_total', round(coalesce(sum(i.total), 0), 2),
                                'lines_qty', round(coalesce(sum(i.quantity), 0), 3))
      from public.purchase_items i
      join public.purchases pu on pu.id = i.purchase_id
      join public.products p on p.id = i.product_id
      where pu.bill_date between v_from and v_to
        and (p_location_id is null or pu.location_id = p_location_id)
        and (v_q is null or p.name ilike '%' || v_q || '%' or p.sku ilike v_q || '%' or p.barcode = v_q
             or coalesce(p.category, '') ilike '%' || v_q || '%'));
  end if;

  return jsonb_build_object('by', v_by, 'total', v_total, 'totals', v_totals, 'rows', v_rows);
end;
$$;

revoke all on function public.report_khata_ageing(uuid, text, text, text, text, integer, integer) from public, anon;
revoke all on function public.report_khata_statement(uuid, date, date, integer) from public, anon;
revoke all on function public.report_payment_register(date, date, uuid, text, text, text, integer, integer) from public, anon;
revoke all on function public.report_registers(date, date, uuid, integer, integer) from public, anon;
revoke all on function public.report_purchases(date, date, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.report_khata_ageing(uuid, text, text, text, text, integer, integer) to authenticated;
grant execute on function public.report_khata_statement(uuid, date, date, integer) to authenticated;
grant execute on function public.report_payment_register(date, date, uuid, text, text, text, integer, integer) to authenticated;
grant execute on function public.report_registers(date, date, uuid, integer, integer) to authenticated;
grant execute on function public.report_purchases(date, date, uuid, text, text, integer, integer) to authenticated;

notify pgrst, 'reload schema';
