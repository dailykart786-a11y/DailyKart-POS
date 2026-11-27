-- =====================================================================
-- DailyKart: report breakdowns (Reports, Phase 3)
--   * report_breakdown(from, to, store, by): the period's sales split by
--     'category', 'cashier', 'payment' (how bills were paid) or 'weekday'.
--     Same definitions as report_period: ex-GST, returns netted on the
--     return day, cost from the snapshot taken at the time of sale, bill
--     lines with no saved cost left out of profit and counted.
-- Read-only, runs with the caller's own access, needs the Reports
-- permission, India days. Safe to run more than once.
-- =====================================================================

create or replace function public.report_breakdown(p_from date, p_to date, p_location_id uuid default null, p_by text default 'category')
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_from date := least(p_from, p_to);
  v_to date := greatest(p_from, p_to);
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_by text := lower(coalesce(p_by, 'category'));
  v_out jsonb;
begin
  if not public.has_perm('reports') then
    raise exception 'Your role doesn''t allow reports';
  end if;
  if v_by not in ('category', 'cashier', 'payment', 'weekday') then
    raise exception 'Unknown breakdown: %', p_by;
  end if;
  v_t0 := v_from::timestamp at time zone 'Asia/Kolkata';
  v_t1 := (v_to + 1)::timestamp at time zone 'Asia/Kolkata';

  if v_by = 'payment' then
    -- How bills were paid. A split bill adds each part to its own method once.
    with s as (
      select x.total_amount, x.payment_method, x.payment_split, x.credit_amount
      from public.sales x
      where x.created_at >= v_t0 and x.created_at < v_t1
        and coalesce(x.status, 'completed') <> 'cancelled'
        and (p_location_id is null or x.location_id = p_location_id)
    ), parts as (
      select case when payment_method = 'split' then kv.key else coalesce(payment_method, 'cash') end as method,
             case when payment_method = 'split' then kv.value::text::numeric else total_amount end as amount,
             payment_method = 'split' as is_split
      from s
      left join lateral jsonb_each(case when s.payment_method = 'split' then s.payment_split else null end) kv on true
      where s.payment_method <> 'split' or kv.key is not null
    )
    select coalesce(jsonb_agg(jsonb_build_object('key', method, 'label', method, 'amount', round(amt, 2),
                                                 'bills', n, 'split_parts', sp) order by amt desc), '[]'::jsonb)
      into v_out
    from (select method, sum(amount) as amt, count(*) as n, count(*) filter (where is_split) as sp
          from parts where amount <> 0 group by method) g;
    return v_out;
  end if;

  with s as (
    select x.id, x.cashier_id, x.created_at, x.total_amount, coalesce(x.tax_amount, 0) as tax, coalesce(x.discount_amount, 0) as discount
    from public.sales x
    where x.created_at >= v_t0 and x.created_at < v_t1
      and coalesce(x.status, 'completed') <> 'cancelled'
      and (p_location_id is null or x.location_id = p_location_id)
  ), lines as (
    -- one row per bill line, with the grouping key
    select case v_by when 'category' then coalesce(nullif(trim(p.category), ''), 'Uncategorised')
                     when 'cashier' then s.cashier_id::text
                     else extract(isodow from s.created_at at time zone 'Asia/Kolkata')::int::text end as k,
           s.id as sale_id, i.quantity,
           i.total_price - coalesce(i.gst_amount, 0) as taxable,
           coalesce(i.gst_amount, 0) as gst,
           round(i.quantity * i.unit_price * coalesce(i.discount_percent, 0) / 100, 2) as discount,
           not exists (select 1 from public.stock_movements sm
                       where sm.source_id = i.sale_id and sm.product_id = i.product_id and sm.movement_type = 'sale') as no_cost
    from s
    join public.sale_items i on i.sale_id = s.id
    left join public.products p on p.id = i.product_id
  ), sl as (
    select k, count(distinct sale_id) as bills, sum(quantity) as units, sum(taxable) as taxable, sum(gst) as gst,
           sum(discount) as discount, sum(taxable) filter (where no_cost) as nocost
    from lines group by k
  ), rl as (
    -- returns, on the day of the return, keyed the same way
    select case v_by when 'category' then coalesce(nullif(trim(p.category), ''), 'Uncategorised')
                     when 'cashier' then r.created_by::text
                     else extract(isodow from r.created_at at time zone 'Asia/Kolkata')::int::text end as k,
           sum(ri.amount - coalesce(ri.gst_amount, 0)) as value, count(distinct r.id) as n
    from public.sale_returns r
    join public.sale_return_items ri on ri.return_id = r.id
    left join public.products p on p.id = ri.product_id
    where r.created_at >= v_t0 and r.created_at < v_t1
      and (p_location_id is null or r.location_id = p_location_id)
    group by 1
  ), ml as (
    -- cost of what was sold and given back; cashier uses the bill's cashier / the return's staff
    select case v_by when 'category' then coalesce(nullif(trim(p.category), ''), 'Uncategorised')
                     when 'cashier' then coalesce(sx.cashier_id::text, rx.created_by::text)
                     else extract(isodow from m.created_at at time zone 'Asia/Kolkata')::int::text end as k,
           sum(case when m.movement_type = 'sale' then -m.quantity_change * coalesce(m.unit_cost, 0)
                    else -m.quantity_change * public.report_return_cost(m.source_id, m.product_id, m.unit_cost) end) as cogs
    from public.stock_movements m
    left join public.products p on p.id = m.product_id
    left join public.sales sx on v_by = 'cashier' and m.movement_type = 'sale' and sx.id = m.source_id
    left join public.sale_returns rx on v_by = 'cashier' and m.movement_type = 'return' and rx.id = m.source_id
    where m.movement_type in ('sale', 'return') and m.created_at >= v_t0 and m.created_at < v_t1
      and (p_location_id is null or m.location_id = p_location_id)
    group by 1
  ), keys as (
    select k from sl union select k from rl
  ), rows as (
    select keys.k,
           case v_by when 'cashier' then coalesce(nullif(trim(pf.full_name), ''), 'Staff ' || left(keys.k, 4))
                     when 'weekday' then (array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])[keys.k::int]
                     else keys.k end as label,
           coalesce(sl.bills, 0) as bills, coalesce(sl.units, 0) as units,
           coalesce(sl.taxable, 0) + coalesce(sl.discount, 0) as gross, coalesce(sl.discount, 0) as discount,
           coalesce(rl.value, 0) as returns, coalesce(rl.n, 0) as return_count,
           coalesce(sl.taxable, 0) - coalesce(rl.value, 0) as net, coalesce(sl.gst, 0) as gst,
           coalesce(sl.nocost, 0) as nocost, coalesce(ml.cogs, 0) as cogs
    from keys
    left join sl on sl.k = keys.k
    left join rl on rl.k = keys.k
    left join ml on ml.k = keys.k
    left join public.profiles pf on v_by = 'cashier' and pf.user_id::text = keys.k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', k, 'label', label, 'bills', bills, 'units', round(units, 3),
           'gross_sales', round(gross, 2), 'discounts', round(discount, 2), 'returns', round(returns, 2),
           'return_count', return_count, 'net_sales', round(net, 2), 'gst', round(gst, 2),
           'avg_bill', case when bills > 0 then round((net + returns + gst) / bills, 2) end,
           'cogs', round(cogs, 2), 'cost_missing_value', round(nocost, 2),
           'gross_profit', round(net - nocost - cogs, 2),
           'gross_margin', case when net - nocost > 0 then round((net - nocost - cogs) * 100 / (net - nocost), 2) end
         ) order by case when v_by = 'weekday' then k::int end, net desc), '[]'::jsonb)
    into v_out
  from rows;
  return v_out;
end;
$$;

revoke all on function public.report_breakdown(date, date, uuid, text) from public, anon;
grant execute on function public.report_breakdown(date, date, uuid, text) to authenticated;

notify pgrst, 'reload schema';
