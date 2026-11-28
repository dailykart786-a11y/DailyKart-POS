-- =====================================================================
-- DailyKart: report numbers worked out in the database (Reports, Phase 2)
--   * report_period(from, to, store): every headline figure for a period,
--     using the definitions in the Reports audit (ex-GST profit, cost
--     from the snapshot taken at the time of sale, returns netted, split
--     payments counted once per method, udhaar never counted as money in)
--   * report_trend(from, to, store, grain): the same figures per day,
--     week, month, year or hour of day, for charts
--   * report_products(...): sales, returns, cost and profit per product,
--     one page at a time
--   * report_customers(...): spend, bills and dues per customer, one
--     page at a time
--   * report_expenses(from, to, store): approved expenses by category
--     and by payment method, plus how many are waiting for approval
-- Read-only: nothing is stored and no bill is changed. Runs with the
-- caller's own access (row level security applies) and needs the Reports
-- permission. Days are India days (Asia/Kolkata). Safe to run more than once.
-- =====================================================================

-- ---------- Cost of a returned item: the cost recorded when it was sold
-- A return's own stock movement carries the cost on the day of the return.
-- Profit should reverse the cost that was charged on the original bill, so
-- look that up first and fall back to the return-day cost.
create or replace function public.report_return_cost(p_return_id uuid, p_product_id uuid, p_fallback numeric)
returns numeric language sql stable security invoker set search_path = public as $$
  select coalesce((
    select sm.unit_cost
    from public.sale_return_items ri
    join public.sale_items si on si.id = ri.sale_item_id
    join public.stock_movements sm
      on sm.source_id = si.sale_id and sm.product_id = si.product_id and sm.movement_type = 'sale'
    where ri.return_id = p_return_id and ri.product_id = p_product_id and sm.unit_cost is not null
    order by sm.created_at
    limit 1
  ), p_fallback, 0)
$$;

-- ---------- One period's figures
create or replace function public.report_period(p_from date, p_to date, p_location_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_from date := least(p_from, p_to);
  v_to date := greatest(p_from, p_to);
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_out jsonb;
begin
  if not public.has_perm('reports') then
    raise exception 'Your role doesn''t allow reports';
  end if;
  v_t0 := v_from::timestamp at time zone 'Asia/Kolkata';
  v_t1 := (v_to + 1)::timestamp at time zone 'Asia/Kolkata';

  with s as (
    select x.id, x.total_amount, coalesce(x.tax_amount, 0) as tax, coalesce(x.discount_amount, 0) as discount,
           x.payment_method, x.payment_split, x.credit_amount, x.customer_id
    from public.sales x
    where x.created_at >= v_t0 and x.created_at < v_t1
      and coalesce(x.status, 'completed') <> 'cancelled'
      and (p_location_id is null or x.location_id = p_location_id)
  ), tot as (
    select coalesce(sum(total_amount), 0) as billed, coalesce(sum(tax), 0) as tax,
           coalesce(sum(discount), 0) as discount, count(*) as bills,
           count(distinct customer_id) as buyers
    from s
  ), items as (
    select coalesce(sum(i.quantity), 0) as units
    from public.sale_items i join s on s.id = i.sale_id
  ), pay as (
    select
      coalesce(sum(case payment_method when 'cash' then total_amount when 'split' then coalesce((payment_split->>'cash')::numeric, 0) else 0 end), 0) as cash,
      coalesce(sum(case payment_method when 'upi' then total_amount when 'split' then coalesce((payment_split->>'upi')::numeric, 0) else 0 end), 0) as upi,
      coalesce(sum(case payment_method when 'card' then total_amount when 'split' then coalesce((payment_split->>'card')::numeric, 0) else 0 end), 0) as card,
      coalesce(sum(case payment_method when 'bank' then total_amount when 'split' then coalesce((payment_split->>'bank')::numeric, 0) else 0 end), 0) as bank,
      coalesce(sum(coalesce(credit_amount, case when payment_method = 'credit' then total_amount else 0 end)), 0) as credit,
      count(*) filter (where payment_method = 'split') as split_bills
    from s
  ), ret as (
    select coalesce(sum(x.refund_amount), 0) as amount, coalesce(sum(x.tax_amount), 0) as tax, count(*) as n,
           coalesce(sum(x.refund_amount) filter (where x.refund_method = 'cash'), 0) as cash,
           coalesce(sum(x.refund_amount) filter (where x.refund_method = 'upi'), 0) as upi,
           coalesce(sum(x.refund_amount) filter (where x.refund_method = 'card'), 0) as card,
           coalesce(sum(x.refund_amount) filter (where x.refund_method = 'khata'), 0) as khata
    from public.sale_returns x
    where x.created_at >= v_t0 and x.created_at < v_t1
      and (p_location_id is null or x.location_id = p_location_id)
  ), kp as (
    select coalesce(sum(amount) filter (where method = 'cash'), 0) as cash,
           coalesce(sum(amount) filter (where method = 'upi'), 0) as upi,
           coalesce(sum(amount) filter (where method = 'card'), 0) as card,
           coalesce(sum(amount) filter (where method = 'bank'), 0) as bank,
           count(*) as n
    from public.customer_payments
    where created_at >= v_t0 and created_at < v_t1 and reversed_at is null
      and (p_location_id is null or location_id = p_location_id)
  ), mv as (
    select
      coalesce(sum(-m.quantity_change * coalesce(m.unit_cost, 0)) filter (where m.movement_type = 'sale'), 0) as sold_cost,
      coalesce(sum(m.quantity_change * public.report_return_cost(m.source_id, m.product_id, m.unit_cost))
               filter (where m.movement_type = 'return'), 0) as returned_cost,
      coalesce(sum(-m.quantity_change * coalesce(m.unit_cost, 0))
               filter (where m.movement_type not in ('sale', 'return', 'purchase', 'purchase_return', 'opening')), 0) as written_off
    from public.stock_movements m
    where m.created_at >= v_t0 and m.created_at < v_t1
      and (p_location_id is null or m.location_id = p_location_id)
  ), nocost as (
    -- bill lines with no stock movement (so no cost snapshot): left out of profit
    select count(*) as lines, coalesce(sum(i.total_price - coalesce(i.gst_amount, 0)), 0) as value
    from public.sale_items i join s on s.id = i.sale_id
    where not exists (select 1 from public.stock_movements sm
                      where sm.source_id = i.sale_id and sm.product_id = i.product_id and sm.movement_type = 'sale')
  ), exp as (
    select coalesce(sum(amount), 0) as amt, count(*) as n
    from public.expenses
    where date between v_from and v_to and coalesce(status, 'approved') = 'approved'
      and (p_location_id is null or location_id = p_location_id)
  ), jv as (
    -- manual journals to other income / expense accounts
    select coalesce(sum(l.credit - l.debit) filter (where a.type = 'income' and a.code not in ('4000', '4100')), 0) as other_income,
           coalesce(sum(l.debit - l.credit) filter (where a.type = 'expense'), 0) as other_expense
    from public.journal_entries j
    join public.journal_lines l on l.entry_id = j.id
    join public.accounts a on a.code = l.account_code
    where j.entry_date between v_from and v_to
      and (p_location_id is null or j.location_id = p_location_id)
  ), pu as (
    select coalesce(sum(taxable_amount), 0) as taxable, coalesce(sum(tax_amount), 0) as tax,
           coalesce(sum(total_amount), 0) as total, count(*) as n
    from public.purchases
    where bill_date between v_from and v_to
      and (p_location_id is null or location_id = p_location_id)
  ), pr as (
    select coalesce(sum(taxable_amount), 0) as taxable, coalesce(sum(tax_amount), 0) as tax,
           coalesce(sum(total_amount), 0) as total, count(*) as n
    from public.purchase_returns
    where created_at >= v_t0 and created_at < v_t1
      and (p_location_id is null or location_id = p_location_id)
  ), calc as (
    select
      tot.billed - tot.tax as taxable,
      tot.billed - tot.tax + tot.discount as gross,
      ret.amount - ret.tax as ret_ex,
      (tot.billed - tot.tax) - (ret.amount - ret.tax) as net_ex,
      mv.sold_cost - mv.returned_cost as cogs
    from tot, ret, mv
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to,
    -- sales (ex-GST unless the name says otherwise)
    'gross_sales', round(calc.gross, 2),
    'discounts', round(tot.discount, 2),
    'taxable_sales', round(calc.taxable, 2),
    'returns', round(calc.ret_ex, 2),
    'returns_count', ret.n,
    'net_sales', round(calc.net_ex, 2),
    'gst_collected', round(tot.tax - ret.tax, 2),
    'gst_on_sales', round(tot.tax, 2),
    'gst_on_returns', round(ret.tax, 2),
    'billed_total', round(tot.billed, 2),
    'refunds_total', round(ret.amount, 2),
    'net_billed', round(tot.billed - ret.amount, 2),
    'bills', tot.bills,
    'avg_bill', case when tot.bills > 0 then round(tot.billed / tot.bills, 2) end,
    'units_sold', round(items.units, 3),
    'buyers', tot.buyers
  ) || jsonb_build_object(
    -- money in (bills paid now, plus udhaar collected); udhaar given is not money in
    'collect_cash', round(pay.cash, 2), 'collect_upi', round(pay.upi, 2),
    'collect_card', round(pay.card, 2), 'collect_bank', round(pay.bank, 2),
    'khata_cash', round(kp.cash, 2), 'khata_upi', round(kp.upi, 2),
    'khata_card', round(kp.card, 2), 'khata_bank', round(kp.bank, 2), 'khata_payments', kp.n,
    'refund_cash', round(ret.cash, 2), 'refund_upi', round(ret.upi, 2),
    'refund_card', round(ret.card, 2), 'refund_khata', round(ret.khata, 2),
    'credit_sales', round(pay.credit, 2),
    'split_bills', pay.split_bills
  ) || jsonb_build_object(
    -- profit
    'cogs', round(calc.cogs, 2),
    'cost_missing_lines', nocost.lines,
    'cost_missing_value', round(nocost.value, 2),
    'gross_profit', round(calc.net_ex - nocost.value - calc.cogs, 2),
    'gross_margin', case when calc.net_ex - nocost.value > 0
                         then round((calc.net_ex - nocost.value - calc.cogs) * 100 / (calc.net_ex - nocost.value), 2) end,
    'expenses', round(exp.amt, 2),
    'expenses_count', exp.n,
    'stock_written_off', round(mv.written_off, 2),
    'other_income', round(jv.other_income, 2),
    'other_expense', round(jv.other_expense, 2),
    'net_profit', round(calc.net_ex - nocost.value - calc.cogs - exp.amt - mv.written_off + jv.other_income - jv.other_expense, 2),
    'net_margin', case when calc.net_ex - nocost.value > 0
                       then round((calc.net_ex - nocost.value - calc.cogs - exp.amt - mv.written_off + jv.other_income - jv.other_expense) * 100
                                  / (calc.net_ex - nocost.value), 2) end
  ) || jsonb_build_object(
    -- purchases (by supplier bill date)
    'purchases_taxable', round(pu.taxable, 2), 'purchases_tax', round(pu.tax, 2),
    'purchases_total', round(pu.total, 2), 'purchases_count', pu.n,
    'purchase_returns_total', round(pr.total, 2), 'purchase_returns_tax', round(pr.tax, 2),
    'purchase_returns_count', pr.n,
    'net_purchases', round(pu.total - pr.total, 2)
  ) into v_out
  from tot, items, pay, ret, kp, mv, nocost, exp, jv, pu, pr, calc;
  return v_out;
end;
$$;

-- ---------- Position right now (not tied to a period)
create or replace function public.report_position(p_location_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare v_out jsonb;
begin
  if not public.has_perm('reports') then
    raise exception 'Your role doesn''t allow reports';
  end if;
  select jsonb_build_object(
    'as_of', now(),
    'customer_outstanding', (select round(coalesce(sum(balance) filter (where balance > 0), 0), 2) from public.customer_balances
                             where p_location_id is null or location_id = p_location_id),
    'customer_advance', (select round(coalesce(-sum(balance) filter (where balance < 0), 0), 2) from public.customer_balances
                         where p_location_id is null or location_id = p_location_id),
    'customers_owing', (select count(*) filter (where balance > 0.005) from public.customer_balances
                        where p_location_id is null or location_id = p_location_id),
    'supplier_outstanding', (select round(coalesce(sum(balance) filter (where balance > 0), 0), 2) from public.supplier_balances
                             where p_location_id is null or location_id = p_location_id),
    'suppliers_owed', (select count(*) filter (where balance > 0.005) from public.supplier_balances
                       where p_location_id is null or location_id = p_location_id),
    'inventory_value', (select round(coalesce(sum(greatest(coalesce(stock_quantity, 0), 0) * coalesce(cost_price, 0)), 0), 2)
                        from public.products where coalesce(is_active, true)
                          and (p_location_id is null or location_id = p_location_id)),
    'inventory_mrp_value', (select round(coalesce(sum(greatest(coalesce(stock_quantity, 0), 0) * coalesce(mrp, price * (1 + coalesce(gst_rate, 0) / 100), 0)), 0), 2)
                            from public.products where coalesce(is_active, true)
                              and (p_location_id is null or location_id = p_location_id)),
    'sku_count', (select count(*) from public.products where coalesce(is_active, true)
                    and (p_location_id is null or location_id = p_location_id)),
    'stock_units', (select round(coalesce(sum(greatest(coalesce(stock_quantity, 0), 0)), 0), 3) from public.products
                    where coalesce(is_active, true) and (p_location_id is null or location_id = p_location_id)),
    'out_of_stock', (select count(*) from public.products where coalesce(is_active, true) and coalesce(stock_quantity, 0) <= 0
                       and (p_location_id is null or location_id = p_location_id)),
    'low_stock', (select count(*) from public.products where coalesce(is_active, true) and coalesce(stock_quantity, 0) > 0
                    and coalesce(stock_quantity, 0) <= coalesce(min_stock_level, 0)
                    and (p_location_id is null or location_id = p_location_id))
  ) into v_out;
  return v_out;
end;
$$;

-- ---------- Figures per day / week / month / year / hour, for charts
-- grain: 'day' | 'week' | 'month' | 'year' | 'hour' (hour of day across the period)
create or replace function public.report_trend(p_from date, p_to date, p_location_id uuid default null, p_grain text default 'day')
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_from date := least(p_from, p_to);
  v_to date := greatest(p_from, p_to);
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_grain text := lower(coalesce(p_grain, 'day'));
  v_out jsonb;
begin
  if not public.has_perm('reports') then
    raise exception 'Your role doesn''t allow reports';
  end if;
  if v_grain not in ('day', 'week', 'month', 'year', 'hour') then
    raise exception 'Unknown grouping: %', p_grain;
  end if;
  if v_grain in ('day', 'hour') and v_to - v_from > 400 then
    raise exception 'Pick at most about 13 months when grouping by day or hour';
  end if;
  if v_to - v_from > 3660 then
    raise exception 'Pick at most 10 years';
  end if;
  v_t0 := v_from::timestamp at time zone 'Asia/Kolkata';
  v_t1 := (v_to + 1)::timestamp at time zone 'Asia/Kolkata';

  with b as (
    -- every bucket in the range, so days with no sales show as zero
    select case v_grain when 'hour' then null else g::date end as d, h
    from (
      select generate_series(date_trunc(case v_grain when 'hour' then 'day' else v_grain end, v_from::timestamp),
                             v_to::timestamp,
                             case v_grain when 'day' then interval '1 day' when 'week' then interval '1 week'
                                          when 'month' then interval '1 month' when 'year' then interval '1 year'
                                          else interval '100 years' end) as g
    ) gs
    cross join lateral (select generate_series(0, case v_grain when 'hour' then 23 else 0 end) as h) hh
  ), s as (
    select x.id, case v_grain when 'hour' then null else date_trunc(v_grain, x.created_at at time zone 'Asia/Kolkata')::date end as d,
           case v_grain when 'hour' then extract(hour from x.created_at at time zone 'Asia/Kolkata')::int else 0 end as h,
           x.total_amount, coalesce(x.tax_amount, 0) as tax, coalesce(x.discount_amount, 0) as discount
    from public.sales x
    where x.created_at >= v_t0 and x.created_at < v_t1
      and coalesce(x.status, 'completed') <> 'cancelled'
      and (p_location_id is null or x.location_id = p_location_id)
  ), sa as (
    select d, h, count(*) as bills, sum(total_amount) as billed, sum(tax) as tax, sum(discount) as discount
    from s group by d, h
  ), nc as (
    -- bill lines with no saved cost are left out of profit, as in report_period
    select s.d, s.h, sum(i.total_price - coalesce(i.gst_amount, 0)) as value
    from s join public.sale_items i on i.sale_id = s.id
    where not exists (select 1 from public.stock_movements sm
                      where sm.source_id = i.sale_id and sm.product_id = i.product_id and sm.movement_type = 'sale')
    group by s.d, s.h
  ), r as (
    select case v_grain when 'hour' then null else date_trunc(v_grain, x.created_at at time zone 'Asia/Kolkata')::date end as d,
           case v_grain when 'hour' then extract(hour from x.created_at at time zone 'Asia/Kolkata')::int else 0 end as h,
           sum(x.refund_amount) as refunds, sum(x.tax_amount) as tax
    from public.sale_returns x
    where x.created_at >= v_t0 and x.created_at < v_t1
      and (p_location_id is null or x.location_id = p_location_id)
    group by 1, 2
  ), m as (
    select case v_grain when 'hour' then null else date_trunc(v_grain, x.created_at at time zone 'Asia/Kolkata')::date end as d,
           case v_grain when 'hour' then extract(hour from x.created_at at time zone 'Asia/Kolkata')::int else 0 end as h,
           sum(case when x.movement_type = 'sale' then -x.quantity_change * coalesce(x.unit_cost, 0)
                    else -x.quantity_change * public.report_return_cost(x.source_id, x.product_id, x.unit_cost) end) as cogs
    from public.stock_movements x
    where x.movement_type in ('sale', 'return') and x.created_at >= v_t0 and x.created_at < v_t1
      and (p_location_id is null or x.location_id = p_location_id)
    group by 1, 2
  ), e as (
    select case v_grain when 'hour' then null else date_trunc(v_grain, x.date::timestamp)::date end as d, 0 as h,
           sum(x.amount) as amt
    from public.expenses x
    where x.date between v_from and v_to and coalesce(x.status, 'approved') = 'approved'
      and (p_location_id is null or x.location_id = p_location_id)
      and v_grain <> 'hour'
    group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'bucket', case v_grain when 'hour' then lpad(b.h::text, 2, '0') || ':00' else b.d::text end,
           'bills', coalesce(sa.bills, 0),
           'billed_total', round(coalesce(sa.billed, 0), 2),
           'gross_sales', round(coalesce(sa.billed - sa.tax + sa.discount, 0), 2),
           'discounts', round(coalesce(sa.discount, 0), 2),
           'tax', round(coalesce(sa.tax, 0) - coalesce(r.tax, 0), 2),
           'returns', round(coalesce(r.refunds - r.tax, 0), 2),
           'net_sales', round(coalesce(sa.billed - sa.tax, 0) - coalesce(r.refunds - r.tax, 0), 2),
           'cogs', round(coalesce(m.cogs, 0), 2),
           'cost_missing_value', round(coalesce(nc.value, 0), 2),
           'gross_profit', round(coalesce(sa.billed - sa.tax, 0) - coalesce(r.refunds - r.tax, 0) - coalesce(nc.value, 0) - coalesce(m.cogs, 0), 2),
           'expenses', round(coalesce(e.amt, 0), 2)
         ) order by b.d nulls first, b.h), '[]'::jsonb)
    into v_out
  from b
  left join sa on sa.d is not distinct from b.d and sa.h = b.h
  left join nc on nc.d is not distinct from b.d and nc.h = b.h
  left join r on r.d is not distinct from b.d and r.h = b.h
  left join m on m.d is not distinct from b.d and m.h = b.h
  left join e on e.d is not distinct from b.d and e.h = b.h;
  return v_out;
end;
$$;

-- ---------- Per product, one page at a time
-- sort: revenue | units | profit | margin | returns | name ; dir: desc | asc
create or replace function public.report_products(
  p_from date, p_to date, p_location_id uuid default null,
  p_category text default null, p_search text default null,
  p_sort text default 'revenue', p_dir text default 'desc',
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
  v_out jsonb;
begin
  if not public.has_perm('reports') then
    raise exception 'Your role doesn''t allow reports';
  end if;
  v_t0 := v_from::timestamp at time zone 'Asia/Kolkata';
  v_t1 := (v_to + 1)::timestamp at time zone 'Asia/Kolkata';

  with si as (
    select i.product_id, sum(i.quantity) as units,
           sum(i.total_price - coalesce(i.gst_amount, 0)) as revenue,
           sum(round(i.quantity * i.unit_price * coalesce(i.discount_percent, 0) / 100, 2)) as discount,
           count(distinct i.sale_id) as bills
    from public.sale_items i
    join public.sales x on x.id = i.sale_id
    where x.created_at >= v_t0 and x.created_at < v_t1
      and coalesce(x.status, 'completed') <> 'cancelled'
      and (p_location_id is null or x.location_id = p_location_id)
    group by i.product_id
  ), ri as (
    select i.product_id, sum(i.quantity) as qty, sum(i.amount - coalesce(i.gst_amount, 0)) as value
    from public.sale_return_items i
    join public.sale_returns x on x.id = i.return_id
    where x.created_at >= v_t0 and x.created_at < v_t1
      and (p_location_id is null or x.location_id = p_location_id)
    group by i.product_id
  ), mc as (
    select x.product_id,
           sum(case when x.movement_type = 'sale' then -x.quantity_change * coalesce(x.unit_cost, 0)
                    else -x.quantity_change * public.report_return_cost(x.source_id, x.product_id, x.unit_cost) end) as cogs,
           bool_or(x.movement_type = 'sale') as has_cost
    from public.stock_movements x
    where x.movement_type in ('sale', 'return') and x.created_at >= v_t0 and x.created_at < v_t1
      and (p_location_id is null or x.location_id = p_location_id)
    group by x.product_id
  ), nc as (
    -- bill lines with no saved cost: left out of profit, as in report_period
    select i.product_id, sum(i.total_price - coalesce(i.gst_amount, 0)) as value
    from public.sale_items i
    join public.sales x on x.id = i.sale_id
    where x.created_at >= v_t0 and x.created_at < v_t1
      and coalesce(x.status, 'completed') <> 'cancelled'
      and (p_location_id is null or x.location_id = p_location_id)
      and not exists (select 1 from public.stock_movements sm
                      where sm.source_id = i.sale_id and sm.product_id = i.product_id and sm.movement_type = 'sale')
    group by i.product_id
  ), rows as (
    select p.id, coalesce(p.name, '') as name, p.sku, p.barcode, p.category, p.hsn_code,
           coalesce(si.units, 0) as units, coalesce(si.revenue, 0) as revenue, coalesce(si.discount, 0) as discount,
           coalesce(si.bills, 0) as bills,
           coalesce(ri.qty, 0) as returned_qty, coalesce(ri.value, 0) as returned_value,
           coalesce(si.revenue, 0) - coalesce(ri.value, 0) as net_revenue,
           case when coalesce(mc.has_cost, false) or si.product_id is null then coalesce(mc.cogs, 0) end as cogs,
           coalesce(nc.value, 0) as nocost,
           p.stock_quantity, p.price, p.mrp, p.cost_price
    from public.products p
    left join si on si.product_id = p.id
    left join ri on ri.product_id = p.id
    left join mc on mc.product_id = p.id
    left join nc on nc.product_id = p.id
    where (si.product_id is not null or ri.product_id is not null)
      and (p_location_id is null or p.location_id = p_location_id)
      and (p_category is null or p.category = p_category)
      and (v_q is null or p.name ilike '%' || v_q || '%' or p.sku ilike v_q || '%' or p.barcode = v_q)
  ), calc as (
    select r.*, r.net_revenue - r.nocost - r.cogs as profit,
           case when r.net_revenue - r.nocost > 0 and r.cogs is not null
                then round((r.net_revenue - r.nocost - r.cogs) * 100 / (r.net_revenue - r.nocost), 2) end as margin
    from rows r
  )
  select jsonb_build_object(
    'total', (select count(*) from calc),
    'totals', (select jsonb_build_object('units', round(coalesce(sum(units), 0), 3), 'revenue', round(coalesce(sum(revenue), 0), 2),
                                         'returned_value', round(coalesce(sum(returned_value), 0), 2),
                                         'net_revenue', round(coalesce(sum(net_revenue), 0), 2),
                                         'cogs', round(coalesce(sum(cogs), 0), 2), 'profit', round(coalesce(sum(profit), 0), 2),
                                         'cost_missing_value', round(coalesce(sum(nocost), 0), 2))
               from calc),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(t) - 'ord') from (
        select c.id as product_id, c.name, c.sku, c.barcode, c.category, c.hsn_code,
               round(c.units, 3) as units, round(c.revenue, 2) as revenue, round(c.discount, 2) as discount, c.bills,
               round(c.returned_qty, 3) as returned_qty, round(c.returned_value, 2) as returned_value,
               round(c.net_revenue, 2) as net_revenue, round(c.cogs, 2) as cogs, round(c.nocost, 2) as cost_missing_value,
               round(c.profit, 2) as profit, c.margin,
               c.stock_quantity, c.price, c.mrp, c.cost_price,
               row_number() over (order by
                 case when lower(p_dir) = 'asc' then null else
                   case lower(coalesce(p_sort, 'revenue')) when 'units' then c.units when 'profit' then c.profit
                     when 'margin' then c.margin when 'returns' then c.returned_value else c.net_revenue end end desc nulls last,
                 case when lower(p_dir) = 'asc' then
                   case lower(coalesce(p_sort, 'revenue')) when 'units' then c.units when 'profit' then c.profit
                     when 'margin' then c.margin when 'returns' then c.returned_value else c.net_revenue end end asc nulls last,
                 case when lower(p_sort) = 'name' then c.name end,
                 c.name, c.id) as ord
        from calc c
        order by ord
        limit v_limit offset v_offset
      ) t), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

-- ---------- Per customer, one page at a time
-- sort: spend | bills | due | last ; dir: desc | asc
create or replace function public.report_customers(
  p_from date, p_to date, p_location_id uuid default null, p_search text default null,
  p_sort text default 'spend', p_dir text default 'desc',
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
  v_out jsonb;
begin
  if not public.has_perm('reports') then
    raise exception 'Your role doesn''t allow reports';
  end if;
  v_t0 := v_from::timestamp at time zone 'Asia/Kolkata';
  v_t1 := (v_to + 1)::timestamp at time zone 'Asia/Kolkata';

  with s as (
    select x.customer_id, count(*) as bills, sum(x.total_amount) as spend, max(x.created_at) as last_at
    from public.sales x
    where x.created_at >= v_t0 and x.created_at < v_t1 and x.customer_id is not null
      and coalesce(x.status, 'completed') <> 'cancelled'
      and (p_location_id is null or x.location_id = p_location_id)
    group by x.customer_id
  ), r as (
    select x.customer_id, sum(x.refund_amount) as refunds
    from public.sale_returns x
    where x.created_at >= v_t0 and x.created_at < v_t1 and x.customer_id is not null
      and (p_location_id is null or x.location_id = p_location_id)
    group by x.customer_id
  ), firsts as (
    select x.customer_id, min(x.created_at) as first_at
    from public.sales x join s on s.customer_id = x.customer_id
    where coalesce(x.status, 'completed') <> 'cancelled'
    group by x.customer_id
  ), rows as (
    select c.id, c.name, c.phone, s.bills, s.spend, coalesce(r.refunds, 0) as refunds,
           s.spend - coalesce(r.refunds, 0) as net_spend, s.last_at, f.first_at,
           f.first_at >= v_t0 as is_new,
           coalesce(cb.balance, 0) as due, c.loyalty_points
    from s
    join public.customers c on c.id = s.customer_id
    left join r on r.customer_id = s.customer_id
    left join firsts f on f.customer_id = s.customer_id
    left join public.customer_balances cb on cb.customer_id = s.customer_id
    where v_q is null or c.name ilike '%' || v_q || '%' or c.phone ilike '%' || v_q || '%'
  )
  select jsonb_build_object(
    'total', (select count(*) from rows),
    'new_customers', (select count(*) filter (where is_new) from rows),
    'returning_customers', (select count(*) filter (where not is_new) from rows),
    'repeat_customers', (select count(*) filter (where bills > 1) from rows),
    'walk_in_bills', (select count(*) from public.sales x
                      where x.created_at >= v_t0 and x.created_at < v_t1 and x.customer_id is null
                        and coalesce(x.status, 'completed') <> 'cancelled'
                        and (p_location_id is null or x.location_id = p_location_id)),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(t) - 'ord') from (
        select rw.id as customer_id, rw.name, rw.phone, rw.bills, round(rw.spend, 2) as spend,
               round(rw.refunds, 2) as refunds, round(rw.net_spend, 2) as net_spend,
               round(rw.net_spend / nullif(rw.bills, 0), 2) as avg_bill,
               rw.first_at, rw.last_at, rw.is_new, round(rw.due, 2) as due, rw.loyalty_points,
               row_number() over (order by
                 case when lower(p_dir) = 'asc' then null else
                   case lower(coalesce(p_sort, 'spend')) when 'bills' then rw.bills::numeric when 'due' then rw.due
                     when 'last' then extract(epoch from rw.last_at)::numeric else rw.net_spend end end desc nulls last,
                 case when lower(p_dir) = 'asc' then
                   case lower(coalesce(p_sort, 'spend')) when 'bills' then rw.bills::numeric when 'due' then rw.due
                     when 'last' then extract(epoch from rw.last_at)::numeric else rw.net_spend end end asc nulls last,
                 rw.name, rw.id) as ord
        from rows rw
        order by ord
        limit v_limit offset v_offset
      ) t), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

-- ---------- Expenses by category and by payment method
create or replace function public.report_expenses(p_from date, p_to date, p_location_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_from date := least(p_from, p_to);
  v_to date := greatest(p_from, p_to);
  v_out jsonb;
begin
  if not public.has_perm('reports') then
    raise exception 'Your role doesn''t allow reports';
  end if;
  with e as (
    select category, coalesce(payment_method, 'cash') as method, amount, coalesce(status, 'approved') as status,
           recurring_id, coalesce(paid_from_till, false) as from_till
    from public.expenses
    where date between v_from and v_to
      and (p_location_id is null or location_id = p_location_id)
  )
  select jsonb_build_object(
    'total', (select round(coalesce(sum(amount), 0), 2) from e where status = 'approved'),
    'count', (select count(*) from e where status = 'approved'),
    'recurring_total', (select round(coalesce(sum(amount), 0), 2) from e where status = 'approved' and recurring_id is not null),
    'from_till_total', (select round(coalesce(sum(amount), 0), 2) from e where status = 'approved' and from_till),
    'pending_count', (select count(*) from e where status = 'pending'),
    'pending_total', (select round(coalesce(sum(amount), 0), 2) from e where status = 'pending'),
    'rejected_count', (select count(*) from e where status = 'rejected'),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'amount', amt, 'count', n) order by amt desc)
                             from (select coalesce(category, 'Other') as category, round(sum(amount), 2) as amt, count(*) as n
                                   from e where status = 'approved' group by 1) c), '[]'::jsonb),
    'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'amount', amt, 'count', n) order by amt desc)
                           from (select method, round(sum(amount), 2) as amt, count(*) as n
                                 from e where status = 'approved' group by 1) m), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.report_return_cost(uuid, uuid, numeric) from public, anon;
revoke all on function public.report_period(date, date, uuid) from public, anon;
revoke all on function public.report_position(uuid) from public, anon;
revoke all on function public.report_trend(date, date, uuid, text) from public, anon;
revoke all on function public.report_products(date, date, uuid, text, text, text, text, integer, integer) from public, anon;
revoke all on function public.report_customers(date, date, uuid, text, text, text, integer, integer) from public, anon;
revoke all on function public.report_expenses(date, date, uuid) from public, anon;
grant execute on function public.report_return_cost(uuid, uuid, numeric) to authenticated;
grant execute on function public.report_period(date, date, uuid) to authenticated;
grant execute on function public.report_position(uuid) to authenticated;
grant execute on function public.report_trend(date, date, uuid, text) to authenticated;
grant execute on function public.report_products(date, date, uuid, text, text, text, text, integer, integer) to authenticated;
grant execute on function public.report_customers(date, date, uuid, text, text, text, integer, integer) to authenticated;
grant execute on function public.report_expenses(date, date, uuid) to authenticated;

notify pgrst, 'reload schema';
