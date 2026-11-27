-- =====================================================================
-- DailyKart: Reports Phase 7 — sales explorer (filters, grouping,
-- comparison, drill-down).
--   * report_sales_explore(...): net sales, GST, cost and gross profit for
--     bills in the dates, grouped by day / week / month / hour / weekday /
--     category / product / cashier / customer / payment method, after
--     optional filters (category, product, cashier, customer, walk-in or
--     registered customers, payment method), with the same figures for a
--     comparison period. Cost uses the cost saved on each stock movement at
--     the time of sale, never today's purchase price. Returns count on the
--     day they were taken (as in report_period), by the person who took them.
--   * report_filter_options(store): the choices for the filter lists.
-- Read-only: nothing is stored and no bill is changed. Runs with the
-- caller's own access (row level security applies), needs the Reports
-- permission. India days. Safe to run more than once.
-- =====================================================================

create or replace function public.report_sales_explore(
  p_from date, p_to date, p_location_id uuid default null,
  p_group text default 'day',
  p_category text default null, p_product_id uuid default null, p_cashier_id uuid default null,
  p_customer_id uuid default null, p_customer_type text default 'all', p_method text default null,
  p_cmp_from date default null, p_cmp_to date default null,
  p_sort text default 'net_sales', p_dir text default 'desc',
  p_limit integer default 25, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_from date := least(p_from, p_to);
  v_to date := greatest(p_from, p_to);
  v_cf date := least(p_cmp_from, p_cmp_to);
  v_ct date := greatest(p_cmp_from, p_cmp_to);
  v_group text := lower(coalesce(p_group, 'day'));
  v_type text := lower(coalesce(p_customer_type, 'all'));
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_time boolean;
  v_out jsonb;
begin
  if not public.has_perm('reports') then
    raise exception 'Your role doesn''t allow reports';
  end if;
  if v_group not in ('day', 'week', 'month', 'hour', 'weekday', 'category', 'product', 'cashier', 'customer', 'payment') then
    raise exception 'Unknown grouping %', p_group;
  end if;
  if v_to - v_from > 750 or (v_cf is not null and v_ct - v_cf > 750) then
    raise exception 'Pick at most about two years of dates';
  end if;
  v_time := v_group in ('day', 'week', 'month');

  with periods as (
    select 'cur'::text as per, v_from as d0, v_to as d1
    union all
    select 'prev', v_cf, v_ct where v_cf is not null
  ), pw as (
    select per, d0::timestamp at time zone 'Asia/Kolkata' as t0, (d1 + 1)::timestamp at time zone 'Asia/Kolkata' as t1 from periods
  ), sl as (
    -- bill lines, one row per bill and product
    select pw.per, i.sale_id as doc_id, true as is_sale, x.created_at as at, i.product_id,
           x.cashier_id as user_id, x.customer_id, coalesce(x.payment_method, 'cash') as method,
           sum(i.quantity) as qty, sum(i.total_price - coalesce(i.gst_amount, 0)) as net, sum(coalesce(i.gst_amount, 0)) as gst
    from pw
    join public.sales x on x.created_at >= pw.t0 and x.created_at < pw.t1
    join public.sale_items i on i.sale_id = x.id
    where coalesce(x.status, 'completed') <> 'cancelled'
      and (p_location_id is null or x.location_id = p_location_id)
    group by pw.per, i.sale_id, x.created_at, i.product_id, x.cashier_id, x.customer_id, x.payment_method
  ), sc as (
    select l.*,
           (select sum(-sm.quantity_change * coalesce(sm.unit_cost, 0)) from public.stock_movements sm
             where sm.source_id = l.doc_id and sm.product_id = l.product_id and sm.movement_type = 'sale') as cogs
    from sl l
  ), rl as (
    -- returns, on the day they were taken, as negative lines
    select pw.per, r.id as doc_id, false as is_sale, r.created_at as at, ri.product_id,
           r.created_by as user_id, x.customer_id, coalesce(x.payment_method, 'cash') as method,
           -sum(ri.quantity) as qty, -sum(ri.amount - coalesce(ri.gst_amount, 0)) as net, -sum(coalesce(ri.gst_amount, 0)) as gst
    from pw
    join public.sale_returns r on r.created_at >= pw.t0 and r.created_at < pw.t1
    join public.sale_return_items ri on ri.return_id = r.id
    left join public.sales x on x.id = r.sale_id
    where (p_location_id is null or r.location_id = p_location_id)
    group by pw.per, r.id, r.created_at, ri.product_id, r.created_by, x.customer_id, x.payment_method
  ), rc as (
    select l.*,
           (select sum(-sm.quantity_change * public.report_return_cost(sm.source_id, sm.product_id, sm.unit_cost)) from public.stock_movements sm
             where sm.source_id = l.doc_id and sm.product_id = l.product_id and sm.movement_type = 'return') as cogs
    from rl l
  ), lines as (
    select a.*, p.name as product_name, coalesce(nullif(trim(p.category), ''), 'Uncategorised') as category
    from (select * from sc union all select * from rc) a
    left join public.products p on p.id = a.product_id
    where (p_category is null or coalesce(nullif(trim(p.category), ''), 'Uncategorised') = p_category)
      and (p_product_id is null or a.product_id = p_product_id)
      and (p_cashier_id is null or a.user_id = p_cashier_id)
      and (p_customer_id is null or a.customer_id = p_customer_id)
      and (v_type = 'all' or (v_type = 'walkin' and a.customer_id is null) or (v_type = 'registered' and a.customer_id is not null))
      and (p_method is null or a.method = p_method)
  ), keyed as (
    select l.*,
           case v_group
             when 'day' then to_char((l.at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD')
             when 'week' then to_char(date_trunc('week', (l.at at time zone 'Asia/Kolkata'))::date, 'YYYY-MM-DD')
             when 'month' then to_char(date_trunc('month', (l.at at time zone 'Asia/Kolkata'))::date, 'YYYY-MM-DD')
             when 'hour' then to_char(l.at at time zone 'Asia/Kolkata', 'HH24') || ':00'
             when 'weekday' then extract(isodow from (l.at at time zone 'Asia/Kolkata'))::int::text
             when 'category' then l.category
             when 'product' then coalesce(l.product_id::text, '')
             when 'cashier' then coalesce(l.user_id::text, '')
             when 'customer' then coalesce(l.customer_id::text, '')
             else l.method end as gkey,
           (l.is_sale and l.cogs is null) as nocost_line
    from lines l
  ), agg as (
    select per, gkey,
           count(distinct doc_id) filter (where is_sale) as bills,
           sum(qty) as units, sum(net) as net_sales, sum(gst) as gst,
           -sum(net) filter (where not is_sale) as returns,
           sum(net) filter (where nocost_line) as nocost,
           sum(cogs) filter (where not nocost_line) as cogs,
           count(distinct customer_id) as customers,
           min(product_name) as product_name, min(category) as category
    from keyed group by per, gkey
  ), tot as (
    select per, count(distinct doc_id) filter (where is_sale) as bills, sum(qty) as units, sum(net) as net_sales, sum(gst) as gst,
           coalesce(-sum(net) filter (where not is_sale), 0) as returns,
           coalesce(sum(net) filter (where nocost_line), 0) as nocost, coalesce(sum(cogs) filter (where not nocost_line), 0) as cogs,
           count(distinct customer_id) as customers
    from keyed group by per
  ), cur as (
    select a.*, coalesce(a.net_sales, 0) - coalesce(a.nocost, 0) - coalesce(a.cogs, 0) as profit,
           pv.net_sales as prev_net_sales, pv.net_sales - coalesce(pv.nocost, 0) - coalesce(pv.cogs, 0) as prev_profit, pv.bills as prev_bills
    from agg a
    left join agg pv on pv.per = 'prev' and pv.gkey = a.gkey and not v_time
    where a.per = 'cur'
  ), lab as (
    select c.*,
           case v_group
             when 'product' then coalesce(c.product_name, 'Deleted product')
             when 'cashier' then coalesce(public.report_user_name(nullif(c.gkey, '')::uuid), 'Unnamed staff')
             when 'customer' then case when c.gkey = '' then 'Walk-in customers'
                                       else coalesce((select cu.name from public.customers cu where cu.id = c.gkey::uuid), 'Deleted customer') end
             when 'weekday' then (array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])[c.gkey::int]
             else c.gkey end as label
    from cur c
  ), ord as (
    select l.*, row_number() over (order by
             case when v_time or v_group in ('hour', 'weekday') then null
                  when lower(p_dir) = 'asc' then null else
                    case lower(coalesce(p_sort, 'net_sales')) when 'profit' then l.profit when 'bills' then l.bills
                      when 'units' then l.units when 'change' then l.net_sales - coalesce(l.prev_net_sales, 0) else l.net_sales end end desc nulls last,
             case when lower(p_dir) = 'asc' and not (v_time or v_group in ('hour', 'weekday')) then
                    case lower(coalesce(p_sort, 'net_sales')) when 'profit' then l.profit when 'bills' then l.bills
                      when 'units' then l.units when 'change' then l.net_sales - coalesce(l.prev_net_sales, 0) else l.net_sales end end asc nulls last,
             case when v_group = 'weekday' then l.gkey::int end,
             case when v_time or v_group = 'hour' then l.gkey end,
             l.label, l.gkey) as rn
    from lab l
  )
  select jsonb_build_object(
    'group', v_group, 'from', v_from, 'to', v_to, 'cmp_from', v_cf, 'cmp_to', v_ct,
    'total', (select count(*) from ord),
    'totals', jsonb_build_object(
      'cur', coalesce((select jsonb_build_object('bills', t.bills, 'units', round(t.units, 3), 'net_sales', round(t.net_sales, 2), 'gst', round(t.gst, 2),
                         'returns', round(t.returns, 2), 'cogs', round(t.cogs, 2), 'cost_missing_value', round(t.nocost, 2),
                         'profit', round(t.net_sales - t.nocost - t.cogs, 2), 'customers', t.customers,
                         'margin', case when t.net_sales - t.nocost > 0 then round((t.net_sales - t.nocost - t.cogs) * 100 / (t.net_sales - t.nocost), 2) end,
                         'avg_bill', case when t.bills > 0 then round((t.net_sales + t.returns) / t.bills, 2) end)
                       from tot t where t.per = 'cur'),
                      '{"bills":0,"units":0,"net_sales":0,"gst":0,"returns":0,"cogs":0,"cost_missing_value":0,"profit":0,"customers":0}'::jsonb),
      'prev', case when v_cf is null then null else
               coalesce((select jsonb_build_object('bills', t.bills, 'units', round(t.units, 3), 'net_sales', round(t.net_sales, 2), 'gst', round(t.gst, 2),
                         'returns', round(t.returns, 2), 'cogs', round(t.cogs, 2), 'cost_missing_value', round(t.nocost, 2),
                         'profit', round(t.net_sales - t.nocost - t.cogs, 2), 'customers', t.customers,
                         'margin', case when t.net_sales - t.nocost > 0 then round((t.net_sales - t.nocost - t.cogs) * 100 / (t.net_sales - t.nocost), 2) end,
                         'avg_bill', case when t.bills > 0 then round((t.net_sales + t.returns) / t.bills, 2) end)
                       from tot t where t.per = 'prev'),
                      '{"bills":0,"units":0,"net_sales":0,"gst":0,"returns":0,"cogs":0,"cost_missing_value":0,"profit":0,"customers":0}'::jsonb) end),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', o.gkey, 'label', o.label, 'category', case when v_group = 'product' then o.category end,
        'bills', o.bills, 'units', round(o.units, 3), 'net_sales', round(o.net_sales, 2), 'gst', round(o.gst, 2),
        'returns', round(coalesce(o.returns, 0), 2), 'profit', round(o.profit, 2),
        'margin', case when o.net_sales - coalesce(o.nocost, 0) > 0 then round(o.profit * 100 / (o.net_sales - coalesce(o.nocost, 0)), 2) end,
        'cost_missing_value', round(coalesce(o.nocost, 0), 2), 'customers', o.customers,
        'share', case when (select net_sales from tot where per = 'cur') > 0 then round(o.net_sales * 100 / (select net_sales from tot where per = 'cur'), 2) end,
        'prev_net_sales', round(o.prev_net_sales, 2), 'prev_profit', round(o.prev_profit, 2), 'prev_bills', o.prev_bills) order by o.rn)
      from ord o where o.rn > v_offset and o.rn <= v_offset + v_limit), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

-- ---------- Choices for the filter lists
create or replace function public.report_filter_options(p_location_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.has_perm('reports') then
    raise exception 'Your role doesn''t allow reports';
  end if;
  return jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(c order by c) from (
        select distinct coalesce(nullif(trim(p.category), ''), 'Uncategorised') as c from public.products p
        where p_location_id is null or p.location_id = p_location_id) z), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('id', u, 'name', coalesce(public.report_user_name(u), 'Unnamed staff')) order by coalesce(public.report_user_name(u), 'zzz'))
      from (select distinct x.cashier_id as u from public.sales x
            where x.cashier_id is not null and x.created_at > now() - interval '400 days'
              and (p_location_id is null or x.location_id = p_location_id)
            union
            select st.user_id from public.staff st
            where st.user_id is not null and st.is_active and (p_location_id is null or st.location_id = p_location_id)) z), '[]'::jsonb),
    'methods', coalesce((
      select jsonb_agg(m order by m) from (
        select distinct coalesce(x.payment_method, 'cash') as m from public.sales x
        where x.created_at > now() - interval '400 days' and (p_location_id is null or x.location_id = p_location_id)) z), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.report_sales_explore(date, date, uuid, text, text, uuid, uuid, uuid, text, text, date, date, text, text, integer, integer) from public, anon;
revoke all on function public.report_filter_options(uuid) from public, anon;
grant execute on function public.report_sales_explore(date, date, uuid, text, text, uuid, uuid, uuid, text, text, date, date, text, text, integer, integer) to authenticated;
grant execute on function public.report_filter_options(uuid) to authenticated;

notify pgrst, 'reload schema';
