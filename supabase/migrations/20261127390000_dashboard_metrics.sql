-- =====================================================================
-- DailyKart: dashboard numbers for any date range
--   * dashboard_metrics(from, to, store): sales, returns, profit,
--     expenses, payment split, daily and hourly trend, top and slow
--     products, categories, customers, supplier purchases, and the
--     stock / udhaar / supplier position right now. The same numbers for
--     the previous period of equal length come back too, for comparisons.
-- Read-only. Nothing is stored. Runs with the caller's own access (row
-- level security applies), so a cashier sees only what they could already
-- see. Profit, cost, expense, stock value and supplier figures are
-- left out for roles without the Reports permission. Safe to run more than once.
-- =====================================================================

-- Indexes for these date-range reads (sales, returns, expenses by store and
-- date) come with the security and free-tier update; this works without them.

-- ---------- One period's totals
create or replace function public.dashboard_period(p_from date, p_to date, p_location_id uuid default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  with r as (
    select (p_from::timestamp at time zone 'Asia/Kolkata') as t0,
           ((p_to + 1)::timestamp at time zone 'Asia/Kolkata') as t1
  ), s as (
    select x.total_amount, coalesce(x.tax_amount, 0) as tax, coalesce(x.discount_amount, 0) as discount,
           x.payment_method, x.payment_split, x.credit_amount, x.customer_id
    from public.sales x, r
    where x.created_at >= r.t0 and x.created_at < r.t1
      and coalesce(x.status, 'completed') <> 'cancelled'
      and (p_location_id is null or x.location_id = p_location_id)
  ), pay as (
    select
      coalesce(sum(case payment_method when 'cash' then total_amount when 'split' then coalesce((payment_split->>'cash')::numeric, 0) else 0 end), 0) as cash,
      coalesce(sum(case payment_method when 'upi' then total_amount when 'split' then coalesce((payment_split->>'upi')::numeric, 0) else 0 end), 0) as upi,
      coalesce(sum(case payment_method when 'card' then total_amount when 'split' then coalesce((payment_split->>'card')::numeric, 0) else 0 end), 0) as card,
      coalesce(sum(case payment_method when 'bank' then total_amount when 'split' then coalesce((payment_split->>'bank')::numeric, 0) else 0 end), 0) as bank,
      coalesce(sum(coalesce(credit_amount, case when payment_method = 'credit' then total_amount else 0 end)), 0) as credit
    from s
  ), ret as (
    select coalesce(sum(x.refund_amount), 0) as amount, coalesce(sum(x.tax_amount), 0) as tax, count(*) as n
    from public.sale_returns x, r
    where x.created_at >= r.t0 and x.created_at < r.t1
      and (p_location_id is null or x.location_id = p_location_id)
  ), cogs as (
    select coalesce(sum(case when m.movement_type = 'sale' then -m.quantity_change * coalesce(m.unit_cost, 0)
                             when m.movement_type = 'return' then -m.quantity_change * coalesce(m.unit_cost, 0)
                             else 0 end), 0) as amt
    from public.stock_movements m, r
    where m.movement_type in ('sale', 'return') and m.created_at >= r.t0 and m.created_at < r.t1
      and (p_location_id is null or m.location_id = p_location_id)
  ), exp as (
    select coalesce(sum(amount), 0) as amt
    from public.expenses
    where date between p_from and p_to and coalesce(status, 'approved') = 'approved'
      and (p_location_id is null or location_id = p_location_id)
  ), tot as (
    select coalesce(sum(total_amount), 0) as gross, coalesce(sum(tax), 0) as tax,
           coalesce(sum(discount), 0) as discount, count(*) as bills,
           count(distinct customer_id) as buyers
    from s
  )
  select jsonb_build_object(
    'gross_sales', tot.gross,
    'returns', ret.amount,
    'returns_count', ret.n,
    'net_sales', tot.gross - ret.amount,
    'tax', tot.tax - ret.tax,
    'discount', tot.discount,
    'bills', tot.bills,
    'avg_bill', case when tot.bills > 0 then round(tot.gross / tot.bills, 2) else 0 end,
    'cogs', round(cogs.amt, 2),
    'gross_profit', round((tot.gross - tot.tax) - (ret.amount - ret.tax) - cogs.amt, 2),
    'expenses', exp.amt,
    'net_profit', round((tot.gross - tot.tax) - (ret.amount - ret.tax) - cogs.amt - exp.amt, 2),
    'cash', pay.cash, 'upi', pay.upi, 'card', pay.card, 'bank', pay.bank, 'credit', pay.credit,
    'buyers', tot.buyers
  )
  from tot, ret, cogs, exp, pay
$$;

-- ---------- Everything the dashboard shows
create or replace function public.dashboard_metrics(p_from date, p_to date, p_location_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_from date := least(p_from, p_to);
  v_to date := greatest(p_from, p_to);
  v_days integer;
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_out jsonb;
begin
  -- At most a little over a year at a time, to keep the free database quick
  if v_to - v_from > 370 then v_from := v_to - 370; end if;
  v_days := v_to - v_from + 1;
  v_t0 := v_from::timestamp at time zone 'Asia/Kolkata';
  v_t1 := (v_to + 1)::timestamp at time zone 'Asia/Kolkata';

  with s as (
    select x.id, x.created_at, (x.created_at at time zone 'Asia/Kolkata') as local_at, x.total_amount, x.customer_id
    from public.sales x
    where x.created_at >= v_t0 and x.created_at < v_t1
      and coalesce(x.status, 'completed') <> 'cancelled'
      and (p_location_id is null or x.location_id = p_location_id)
  ), items as (
    select i.product_id, coalesce(p.name, i.product_name, 'Unknown item') as name, coalesce(nullif(p.category, ''), 'Uncategorised') as category,
           i.quantity, i.total_price
    from public.sale_items i
    join s on s.id = i.sale_id
    left join public.products p on p.id = i.product_id
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'days', v_days,
    'current', public.dashboard_period(v_from, v_to, p_location_id),
    'previous', public.dashboard_period(v_from - v_days, v_from - 1, p_location_id),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'day', d.day,
               'sales', coalesce(ds.sales, 0), 'bills', coalesce(ds.bills, 0),
               'returns', coalesce(dr.amount, 0),
               'expenses', coalesce(de.amount, 0),
               'cogs', coalesce(dc.amt, 0)) order by d.day), '[]'::jsonb)
      from (select g::date as day from generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') g) d
      left join (select local_at::date as day, sum(total_amount) as sales, count(*) as bills from s group by 1) ds on ds.day = d.day
      left join (select (created_at at time zone 'Asia/Kolkata')::date as day, sum(refund_amount - tax_amount) as amount
                 from public.sale_returns
                 where created_at >= v_t0 and created_at < v_t1 and (p_location_id is null or location_id = p_location_id)
                 group by 1) dr on dr.day = d.day
      left join (select date as day, sum(amount) as amount from public.expenses
                 where date between v_from and v_to and coalesce(status, 'approved') = 'approved'
                   and (p_location_id is null or location_id = p_location_id)
                 group by 1) de on de.day = d.day
      left join (select (created_at at time zone 'Asia/Kolkata')::date as day,
                        sum(-quantity_change * coalesce(unit_cost, 0)) as amt
                 from public.stock_movements
                 where movement_type in ('sale', 'return') and created_at >= v_t0 and created_at < v_t1
                   and (p_location_id is null or location_id = p_location_id)
                 group by 1) dc on dc.day = d.day
    ),
    'hourly', (
      select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'sales', coalesce(x.sales, 0), 'bills', coalesce(x.bills, 0)) order by h), '[]'::jsonb)
      from generate_series(0, 23) h
      left join (select extract(hour from local_at)::int as hr, sum(total_amount) as sales, count(*) as bills from s group by 1) x on x.hr = h
    ),
    'top_products', (
      select coalesce(jsonb_agg(t order by t.revenue desc), '[]'::jsonb) from (
        select product_id, name, sum(quantity) as qty, sum(total_price) as revenue
        from items group by product_id, name order by sum(total_price) desc limit 10) t
    ),
    'slow_products', (
      select coalesce(jsonb_agg(t order by t.qty, t.stock desc), '[]'::jsonb) from (
        select p.id as product_id, p.name, coalesce(sold.qty, 0) as qty, p.stock_quantity as stock,
               round(greatest(p.stock_quantity, 0) * coalesce(p.cost_price, 0), 2) as stock_value
        from public.products p
        left join (select product_id, sum(quantity) as qty from items group by product_id) sold on sold.product_id = p.id
        where coalesce(p.is_active, true) and p.stock_quantity > 0
          and (p_location_id is null or p.location_id = p_location_id)
        order by coalesce(sold.qty, 0), p.stock_quantity * coalesce(p.cost_price, 0) desc
        limit 10) t
    ),
    'categories', (
      select coalesce(jsonb_agg(t order by t.revenue desc), '[]'::jsonb) from (
        select category, sum(total_price) as revenue, sum(quantity) as qty
        from items group by category order by sum(total_price) desc limit 12) t
    ),
    'top_customers', (
      select coalesce(jsonb_agg(t order by t.spent desc), '[]'::jsonb) from (
        select c.id as customer_id, c.name, count(*) as bills, sum(s.total_amount) as spent
        from s join public.customers c on c.id = s.customer_id
        group by c.id, c.name order by sum(s.total_amount) desc limit 10) t
    ),
    'customers', (
      select jsonb_build_object(
        'total', (select count(*) from public.customers where (p_location_id is null or location_id = p_location_id)),
        'new', (select count(*) from public.customers where created_at >= v_t0 and created_at < v_t1
                  and (p_location_id is null or location_id = p_location_id)),
        'buying', (select count(distinct customer_id) from s where customer_id is not null),
        'returning', (select count(distinct s.customer_id) from s
                      where s.customer_id is not null and exists (
                        select 1 from public.sales o where o.customer_id = s.customer_id and o.created_at < v_t0
                          and coalesce(o.status, 'completed') <> 'cancelled')),
        'walk_in_bills', (select count(*) from s where customer_id is null)
      )
    ),
    'suppliers', (
      select coalesce(jsonb_agg(t order by t.total desc), '[]'::jsonb) from (
        select sp.id as supplier_id, sp.name, count(*) as bills, sum(pu.total_amount) as total
        from public.purchases pu join public.suppliers sp on sp.id = pu.supplier_id
        where pu.bill_date between v_from and v_to and (p_location_id is null or pu.location_id = p_location_id)
        group by sp.id, sp.name order by sum(pu.total_amount) desc limit 8) t
    ),
    'purchases_total', (
      select coalesce(sum(total_amount), 0) from public.purchases
      where bill_date between v_from and v_to and (p_location_id is null or location_id = p_location_id)
    ),
    'now', jsonb_build_object(
      'customer_due', (select coalesce(sum(balance), 0) from public.customer_balances where balance > 0 and (p_location_id is null or location_id = p_location_id)),
      'customers_owing', (select count(*) from public.customer_balances where balance > 0 and (p_location_id is null or location_id = p_location_id)),
      'supplier_due', (select coalesce(sum(balance), 0) from public.supplier_balances where balance > 0 and (p_location_id is null or location_id = p_location_id)),
      'stock_value', (select round(coalesce(sum(greatest(stock_quantity, 0) * coalesce(cost_price, 0)), 0), 2) from public.products
                      where coalesce(is_active, true) and (p_location_id is null or location_id = p_location_id)),
      'low_stock', (select count(*) from public.products
                    where coalesce(is_active, true) and coalesce(min_stock_level, 0) > 0
                      and stock_quantity > 0 and stock_quantity <= min_stock_level
                      and (p_location_id is null or location_id = p_location_id)),
      'out_of_stock', (select count(*) from public.products
                       where coalesce(is_active, true) and stock_quantity <= 0
                         and (p_location_id is null or location_id = p_location_id)),
      'expiring', (select count(*) from public.product_batches b
                   where b.cleared_at is null and b.quantity > 0 and b.expiry_date is not null
                     and b.expiry_date between v_today and v_today + 30
                     and (p_location_id is null or b.location_id = p_location_id)),
      'expired', (select count(*) from public.product_batches b
                  where b.cleared_at is null and b.quantity > 0 and b.expiry_date is not null and b.expiry_date < v_today
                    and (p_location_id is null or b.location_id = p_location_id))
    )
  ) into v_out;

  -- Profit, cost and expense figures only for roles allowed to see reports.
  -- (Without cost data the profit would read too high, so it is left out.)
  if not public.has_perm('reports') then
    v_out := jsonb_set(v_out, '{current}', (v_out->'current') - array['cogs', 'gross_profit', 'net_profit', 'expenses']);
    v_out := jsonb_set(v_out, '{previous}', (v_out->'previous') - array['cogs', 'gross_profit', 'net_profit', 'expenses']);
    v_out := jsonb_set(v_out, '{now}', (v_out->'now') - array['stock_value', 'supplier_due']);
    v_out := jsonb_set(v_out, '{daily}', coalesce((select jsonb_agg(e - array['cogs', 'expenses']) from jsonb_array_elements(v_out->'daily') e), '[]'::jsonb));
    v_out := v_out - array['suppliers', 'purchases_total'];
  end if;
  return v_out;
end;
$$;

revoke all on function public.dashboard_period(date, date, uuid) from public;
revoke all on function public.dashboard_metrics(date, date, uuid) from public;
grant execute on function public.dashboard_period(date, date, uuid) to authenticated;
grant execute on function public.dashboard_metrics(date, date, uuid) to authenticated;

notify pgrst, 'reload schema';
