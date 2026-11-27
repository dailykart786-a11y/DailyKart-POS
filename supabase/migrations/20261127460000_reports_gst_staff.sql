-- =====================================================================
-- DailyKart: Reports Phase 6 — GST summary and staff performance.
--   * report_gst(from, to, store): output GST on bills less credit notes,
--     input GST on supplier bills less returns to suppliers, each by rate
--     and split into CGST/SGST or IGST; HSN-wise outward summary; month by
--     month; data checks (lines without HSN, suppliers without GSTIN).
--     This is a working summary for the owner and the accountant. It is
--     NOT a GST return and is not ready to file as it stands.
--   * report_staff(from, to, store): per staff member — bills, sales,
--     discounts, returns handled, khata collected, register short/over,
--     hours on the register, attendance.
--   * report_user_name(user): staff member's name (profile name, else the
--     Staff page name). Stock movement, payment register and register
--     reports now use it: they looked names up by the wrong profile column
--     and showed none.
-- Read-only: nothing is stored and no bill is changed. Runs with the
-- caller's own access (row level security applies), needs the Reports
-- permission. India days. Safe to run more than once.
-- =====================================================================

create or replace function public.report_user_name(p_user uuid)
returns text language sql stable security invoker set search_path = public as $$
  select coalesce(
    (select nullif(trim(pr.full_name), '') from public.profiles pr where pr.user_id = p_user limit 1),
    (select nullif(trim(st.name), '') from public.staff st where st.user_id = p_user limit 1))
$$;

-- ---------- GST working summary
create or replace function public.report_gst(p_from date, p_to date, p_location_id uuid default null)
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
  if v_to - v_from > 400 then
    raise exception 'Pick at most about 13 months for the GST summary';
  end if;
  v_t0 := v_from::timestamp at time zone 'Asia/Kolkata';
  v_t1 := (v_to + 1)::timestamp at time zone 'Asia/Kolkata';

  with outl as (
    -- outward lines: bills (+) and credit notes (-)
    select 'sale' as src, x.created_at as at, coalesce(x.is_interstate, false) as inter,
           (c.gstin is not null and trim(c.gstin) <> '') as b2b,
           coalesce(i.gst_rate, p.gst_rate, 0) as rate, nullif(trim(coalesce(i.hsn_code, p.hsn_code, '')), '') as hsn,
           i.quantity as qty, i.total_price - coalesce(i.gst_amount, 0) as taxable, coalesce(i.gst_amount, 0) as tax,
           coalesce(i.product_name, p.name) as pname
    from public.sale_items i
    join public.sales x on x.id = i.sale_id
    left join public.products p on p.id = i.product_id
    left join public.customers c on c.id = x.customer_id
    where x.created_at >= v_t0 and x.created_at < v_t1
      and coalesce(x.status, 'completed') <> 'cancelled'
      and (p_location_id is null or x.location_id = p_location_id)
    union all
    select 'return', r.created_at, coalesce(x.is_interstate, false),
           (c.gstin is not null and trim(c.gstin) <> ''),
           coalesce(si.gst_rate, p.gst_rate, 0), nullif(trim(coalesce(si.hsn_code, p.hsn_code, '')), ''),
           -ri.quantity, -(ri.amount - coalesce(ri.gst_amount, 0)), -coalesce(ri.gst_amount, 0),
           coalesce(si.product_name, p.name)
    from public.sale_return_items ri
    join public.sale_returns r on r.id = ri.return_id
    join public.sale_items si on si.id = ri.sale_item_id
    join public.sales x on x.id = r.sale_id
    left join public.products p on p.id = ri.product_id
    left join public.customers c on c.id = x.customer_id
    where r.created_at >= v_t0 and r.created_at < v_t1
      and (p_location_id is null or r.location_id = p_location_id)
  ), outs as (
    select o.*, case when o.inter then 0 else round(o.tax / 2, 2) end as cgst,
           case when o.inter then 0 else o.tax - round(o.tax / 2, 2) end as sgst,
           case when o.inter then o.tax else 0 end as igst
    from outl o
  ), inl as (
    -- inward lines: supplier bills (+) and returns to suppliers (-); IGST when the supplier's state differs from the store's
    select 'purchase' as src, pu.bill_date as d, coalesce(i.gst_rate, 0) as rate,
           i.total - coalesce(i.gst_amount, 0) as taxable, coalesce(i.gst_amount, 0) as tax,
           coalesce(nullif(s.state_code, ''), nullif(left(s.gstin, 2), '')) as sup_state, l.state_code as store_state,
           (s.gstin is not null and trim(s.gstin) <> '') as has_gstin
    from public.purchase_items i
    join public.purchases pu on pu.id = i.purchase_id
    join public.suppliers s on s.id = pu.supplier_id
    left join public.locations l on l.id = pu.location_id
    where pu.bill_date between v_from and v_to
      and (p_location_id is null or pu.location_id = p_location_id)
    union all
    select 'purchase_return', (r.created_at at time zone 'Asia/Kolkata')::date, coalesce(ri.gst_rate, 0),
           -(ri.total - coalesce(ri.gst_amount, 0)), -coalesce(ri.gst_amount, 0),
           coalesce(nullif(s.state_code, ''), nullif(left(s.gstin, 2), '')), l.state_code,
           (s.gstin is not null and trim(s.gstin) <> '')
    from public.purchase_return_items ri
    join public.purchase_returns r on r.id = ri.return_id
    join public.suppliers s on s.id = r.supplier_id
    left join public.locations l on l.id = r.location_id
    where r.created_at >= v_t0 and r.created_at < v_t1
      and (p_location_id is null or r.location_id = p_location_id)
  ), ins as (
    select n.*, (n.sup_state is not null and n.store_state is not null and n.sup_state <> n.store_state) as inter
    from inl n
  ), ins2 as (
    select n.*, case when n.inter then 0 else round(n.tax / 2, 2) end as cgst,
           case when n.inter then 0 else n.tax - round(n.tax / 2, 2) end as sgst,
           case when n.inter then n.tax else 0 end as igst
    from ins n
  ), o_tot as (
    select coalesce(sum(taxable) filter (where src = 'sale'), 0) as s_taxable, coalesce(sum(tax) filter (where src = 'sale'), 0) as s_tax,
           coalesce(-sum(taxable) filter (where src = 'return'), 0) as r_taxable, coalesce(-sum(tax) filter (where src = 'return'), 0) as r_tax,
           coalesce(sum(taxable), 0) as taxable, coalesce(sum(cgst), 0) as cgst, coalesce(sum(sgst), 0) as sgst, coalesce(sum(igst), 0) as igst,
           coalesce(sum(tax), 0) as tax,
           coalesce(sum(taxable) filter (where b2b), 0) as b2b_taxable, coalesce(sum(tax) filter (where b2b), 0) as b2b_tax,
           coalesce(sum(taxable) filter (where not b2b), 0) as b2c_taxable, coalesce(sum(tax) filter (where not b2b), 0) as b2c_tax,
           count(*) filter (where src = 'sale' and hsn is null) as no_hsn_lines,
           coalesce(sum(taxable) filter (where src = 'sale' and hsn is null), 0) as no_hsn_value,
           coalesce(sum(taxable) filter (where src = 'sale' and rate = 0), 0) as zero_rated_value
    from outs
  ), i_tot as (
    select coalesce(sum(taxable) filter (where src = 'purchase'), 0) as p_taxable, coalesce(sum(tax) filter (where src = 'purchase'), 0) as p_tax,
           coalesce(-sum(taxable) filter (where src = 'purchase_return'), 0) as r_taxable, coalesce(-sum(tax) filter (where src = 'purchase_return'), 0) as r_tax,
           coalesce(sum(taxable), 0) as taxable, coalesce(sum(cgst), 0) as cgst, coalesce(sum(sgst), 0) as sgst, coalesce(sum(igst), 0) as igst,
           coalesce(sum(tax), 0) as tax,
           coalesce(sum(tax) filter (where not has_gstin), 0) as no_gstin_tax,
           count(*) filter (where src = 'purchase' and store_state is null) as no_store_state
    from ins2
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to,
    'output', (select jsonb_build_object(
        'sales_taxable', round(s_taxable, 2), 'sales_tax', round(s_tax, 2),
        'credit_notes_taxable', round(r_taxable, 2), 'credit_notes_tax', round(r_tax, 2),
        'taxable', round(taxable, 2), 'cgst', round(cgst, 2), 'sgst', round(sgst, 2), 'igst', round(igst, 2), 'tax', round(tax, 2),
        'b2b_taxable', round(b2b_taxable, 2), 'b2b_tax', round(b2b_tax, 2), 'b2c_taxable', round(b2c_taxable, 2), 'b2c_tax', round(b2c_tax, 2))
      from o_tot),
    'input', (select jsonb_build_object(
        'purchases_taxable', round(p_taxable, 2), 'purchases_tax', round(p_tax, 2),
        'returns_taxable', round(r_taxable, 2), 'returns_tax', round(r_tax, 2),
        'taxable', round(taxable, 2), 'cgst', round(cgst, 2), 'sgst', round(sgst, 2), 'igst', round(igst, 2), 'tax', round(tax, 2),
        'no_gstin_tax', round(no_gstin_tax, 2))
      from i_tot),
    'net', (select jsonb_build_object('cgst', round(o.cgst - i.cgst, 2), 'sgst', round(o.sgst - i.sgst, 2),
                                      'igst', round(o.igst - i.igst, 2), 'tax', round(o.tax - i.tax, 2))
            from o_tot o, i_tot i),
    'checks', (select jsonb_build_object('no_hsn_lines', o.no_hsn_lines, 'no_hsn_value', round(o.no_hsn_value, 2),
                                         'zero_rated_value', round(o.zero_rated_value, 2),
                                         'input_without_gstin_tax', round(i.no_gstin_tax, 2),
                                         'purchases_without_store_state', i.no_store_state)
               from o_tot o, i_tot i),
    'output_by_rate', coalesce((
      select jsonb_agg(jsonb_build_object('rate', rate, 'taxable', round(t, 2), 'cgst', round(c, 2), 'sgst', round(s, 2), 'igst', round(ig, 2), 'tax', round(tx, 2)) order by rate)
      from (select rate, sum(taxable) t, sum(cgst) c, sum(sgst) s, sum(igst) ig, sum(tax) tx from outs group by rate) z), '[]'::jsonb),
    'input_by_rate', coalesce((
      select jsonb_agg(jsonb_build_object('rate', rate, 'taxable', round(t, 2), 'cgst', round(c, 2), 'sgst', round(s, 2), 'igst', round(ig, 2), 'tax', round(tx, 2)) order by rate)
      from (select rate, sum(taxable) t, sum(cgst) c, sum(sgst) s, sum(igst) ig, sum(tax) tx from ins2 group by rate) z), '[]'::jsonb),
    'hsn', coalesce((
      select jsonb_agg(jsonb_build_object('hsn', coalesce(hsn, ''), 'rate', rate, 'description', d, 'qty', round(q, 3), 'taxable', round(t, 2),
                                          'cgst', round(c, 2), 'sgst', round(s, 2), 'igst', round(ig, 2), 'tax', round(tx, 2)) order by hsn nulls last, rate)
      from (select hsn, rate, min(pname) d, sum(qty) q, sum(taxable) t, sum(cgst) c, sum(sgst) s, sum(igst) ig, sum(tax) tx
            from outs group by hsn, rate limit 1000) z), '[]'::jsonb),
    'by_month', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', m, 'output_tax', round(ot, 2), 'input_tax', round(it, 2), 'net', round(ot - it, 2)) order by m)
      from (select m, sum(ot) ot, sum(it) it from (
              select to_char((at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-01') as m, tax as ot, 0 as it from outs
              union all
              select to_char(d, 'YYYY-MM-01'), 0, tax from ins2) u group by m) z), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

-- ---------- Staff performance in the dates
-- One row per person who billed, took a return, collected khata, ran a register or has attendance.
create or replace function public.report_staff(p_from date, p_to date, p_location_id uuid default null)
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
    select x.id, x.cashier_id as u, x.total_amount, coalesce(x.tax_amount, 0) as tax, coalesce(x.discount_amount, 0) as discount
    from public.sales x
    where x.created_at >= v_t0 and x.created_at < v_t1
      and coalesce(x.status, 'completed') <> 'cancelled'
      and (p_location_id is null or x.location_id = p_location_id)
  ), sb as (
    select s.u, count(*) as bills, sum(s.total_amount) as billed, sum(s.total_amount - s.tax) as taxable, sum(s.discount) as discount,
           sum(s.total_amount - s.tax + s.discount) as gross,
           coalesce(sum((select sum(i.quantity) from public.sale_items i where i.sale_id = s.id)), 0) as units,
           count(*) filter (where s.discount > 0) as discounted_bills
    from s group by s.u
  ), rt as (
    select r.created_by as u, count(*) as n, sum(r.refund_amount - coalesce(r.tax_amount, 0)) as value
    from public.sale_returns r
    where r.created_at >= v_t0 and r.created_at < v_t1 and (p_location_id is null or r.location_id = p_location_id)
    group by r.created_by
  ), kp as (
    select p.created_by as u, count(*) as n, sum(p.amount) as amount
    from public.customer_payments p
    where p.created_at >= v_t0 and p.created_at < v_t1 and p.reversed_at is null
      and (p_location_id is null or p.location_id = p_location_id)
    group by p.created_by
  ), rg as (
    select rs.user_id as u, count(*) as sessions,
           coalesce(-sum(rs.difference) filter (where rs.difference < 0), 0) as short,
           count(*) filter (where rs.difference < -0.004) as short_count,
           coalesce(sum(rs.difference), 0) as net_diff,
           coalesce(sum(extract(epoch from (coalesce(rs.closed_at, least(now(), v_t1)) - rs.opened_at)) / 3600.0), 0) as hours
    from public.register_sessions rs
    where rs.opened_at >= v_t0 and rs.opened_at < v_t1 and (p_location_id is null or rs.location_id = p_location_id)
    group by rs.user_id
  ), da as (
    select d.requested_by as u, count(*) as n from public.discount_approvals d
    where d.created_at >= v_t0 and d.created_at < v_t1 and (p_location_id is null or d.location_id = p_location_id)
    group by d.requested_by
  ), at as (
    select st.user_id as u, st.id as staff_id, st.name as staff_name, st.job_title,
           count(a.*) filter (where a.status = 'present') as present, count(a.*) filter (where a.status = 'half_day') as half_days,
           count(a.*) filter (where a.status = 'absent') as absent, count(a.*) filter (where a.status = 'paid_leave') as leave,
           coalesce(sum(a.late_minutes), 0) as late_minutes, count(a.*) filter (where a.late_minutes > 0) as late_days
    from public.staff st
    left join public.attendance a on a.staff_id = st.id and a.date between v_from and v_to
    where st.is_active and (p_location_id is null or st.location_id = p_location_id)
    group by st.user_id, st.id, st.name, st.job_title
  ), people as (
    select u from sb union select u from rt union select u from kp union select u from rg union select u from da
    union select u from at where u is not null
  ), rows as (
    select pe.u,
           coalesce(public.report_user_name(pe.u), at.staff_name) as name, at.job_title,
           coalesce(sb.bills, 0) as bills, coalesce(sb.billed, 0) as billed, coalesce(sb.gross, 0) as gross_sales,
           coalesce(sb.discount, 0) as discounts, coalesce(sb.discounted_bills, 0) as discounted_bills,
           coalesce(rt.n, 0) as returns_count, coalesce(rt.value, 0) as returns_value,
           coalesce(sb.taxable, 0) - coalesce(rt.value, 0) as net_sales,
           coalesce(sb.units, 0) as units,
           coalesce(kp.n, 0) as khata_count, coalesce(kp.amount, 0) as khata_collected,
           coalesce(rg.sessions, 0) as sessions, coalesce(rg.short, 0) as cash_short, coalesce(rg.short_count, 0) as short_count,
           coalesce(rg.net_diff, 0) as cash_net_diff, coalesce(rg.hours, 0) as register_hours,
           coalesce(da.n, 0) as discount_approvals,
           at.present, at.half_days, at.absent, at.leave, at.late_minutes, at.late_days
    from people pe
    left join sb on sb.u = pe.u
    left join rt on rt.u = pe.u
    left join kp on kp.u = pe.u
    left join rg on rg.u = pe.u
    left join da on da.u = pe.u
    left join at on at.u = pe.u
    union all
    -- staff with no app login: attendance only
    select null, at.staff_name, at.job_title, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
           at.present, at.half_days, at.absent, at.leave, at.late_minutes, at.late_days
    from at where at.u is null
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to,
    'totals', (select jsonb_build_object('people', count(*), 'bills', coalesce(sum(bills), 0), 'net_sales', round(coalesce(sum(net_sales), 0), 2),
                                         'discounts', round(coalesce(sum(discounts), 0), 2), 'returns_value', round(coalesce(sum(returns_value), 0), 2),
                                         'cash_short', round(coalesce(sum(cash_short), 0), 2), 'khata_collected', round(coalesce(sum(khata_collected), 0), 2))
               from rows),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', r.u, 'login', r.u is not null, 'name', coalesce(r.name, 'Unnamed staff'), 'job_title', r.job_title,
        'bills', r.bills, 'billed', round(r.billed, 2), 'gross_sales', round(r.gross_sales, 2), 'discounts', round(r.discounts, 2),
        'discount_pct', case when r.gross_sales > 0 then round(r.discounts * 100 / r.gross_sales, 2) end,
        'discounted_bills', r.discounted_bills,
        'returns_count', r.returns_count, 'returns_value', round(r.returns_value, 2), 'net_sales', round(r.net_sales, 2),
        'avg_bill', case when r.bills > 0 then round(r.billed / r.bills, 2) end,
        'units_per_bill', case when r.bills > 0 then round(r.units / r.bills, 2) end,
        'khata_count', r.khata_count, 'khata_collected', round(r.khata_collected, 2),
        'sessions', r.sessions, 'cash_short', round(r.cash_short, 2), 'short_count', r.short_count, 'cash_net_diff', round(r.cash_net_diff, 2),
        'register_hours', round(r.register_hours, 1),
        'sales_per_hour', case when r.register_hours >= 0.25 then round(r.net_sales / r.register_hours, 2) end,
        'discount_approvals', r.discount_approvals,
        'present', r.present, 'half_days', r.half_days, 'absent', r.absent, 'leave', r.leave,
        'late_minutes', r.late_minutes, 'late_days', r.late_days)
        order by r.net_sales desc, r.name)
      from rows r), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

-- ---------- Every stock change in the dates: totals by type and reason, and the entries one page at a time
-- type: null (all) | sale | return | purchase | purchase_return | adjustment | opening | manual
create or replace function public.report_stock_movement(
  p_from date, p_to date, p_location_id uuid default null,
  p_type text default null, p_search text default null,
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
  v_type text := nullif(lower(trim(coalesce(p_type, ''))), '');
  v_out jsonb;
begin
  if not public.has_perm('reports') then
    raise exception 'Your role doesn''t allow reports';
  end if;
  v_t0 := v_from::timestamp at time zone 'Asia/Kolkata';
  v_t1 := (v_to + 1)::timestamp at time zone 'Asia/Kolkata';

  with m as (
    select m.id, m.created_at, m.product_id, m.movement_type, m.quantity_change, m.stock_before, m.stock_after,
           m.source_type, m.source_id, m.note, m.unit_cost, m.created_by,
           p.name, p.sku, p.category
    from public.stock_movements m
    join public.products p on p.id = m.product_id
    where m.created_at >= v_t0 and m.created_at < v_t1
      and (p_location_id is null or m.location_id = p_location_id)
      and (v_q is null or p.name ilike '%' || v_q || '%' or p.sku ilike v_q || '%' or p.barcode = v_q)
  ), sel as (
    select * from m where v_type is null or m.movement_type = v_type
  )
  select jsonb_build_object(
    'total', (select count(*) from sel),
    'by_type', coalesce((
      select jsonb_agg(jsonb_build_object('key', movement_type, 'entries', n, 'qty_in', round(qin, 3), 'qty_out', round(qout, 3),
                                          'value_in', round(vin, 2), 'value_out', round(vout, 2)) order by movement_type)
      from (select movement_type, count(*) as n,
                   coalesce(sum(quantity_change) filter (where quantity_change > 0), 0) as qin,
                   coalesce(-sum(quantity_change) filter (where quantity_change < 0), 0) as qout,
                   coalesce(sum(quantity_change * coalesce(unit_cost, 0)) filter (where quantity_change > 0), 0) as vin,
                   coalesce(-sum(quantity_change * coalesce(unit_cost, 0)) filter (where quantity_change < 0), 0) as vout
            from m group by movement_type) z), '[]'::jsonb),
    'adjust_reasons', coalesce((
      select jsonb_agg(jsonb_build_object('key', reason, 'entries', n, 'qty_in', round(qin, 3), 'qty_out', round(qout, 3),
                                          'net_value', round(v, 2)) order by v)
      from (select coalesce(note, 'other') as reason, count(*) as n,
                   coalesce(sum(quantity_change) filter (where quantity_change > 0), 0) as qin,
                   coalesce(-sum(quantity_change) filter (where quantity_change < 0), 0) as qout,
                   sum(quantity_change * coalesce(unit_cost, 0)) as v
            from m where movement_type = 'adjustment' group by coalesce(note, 'other')) z), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select s.id, s.created_at, s.product_id, s.name, s.sku, s.category, s.movement_type, s.note,
               round(s.quantity_change, 3) as quantity_change, round(s.stock_before, 3) as stock_before,
               round(s.stock_after, 3) as stock_after, s.unit_cost,
               round(s.quantity_change * coalesce(s.unit_cost, 0), 2) as value,
               s.source_type, s.source_id,
               public.report_user_name(s.created_by) as by_name
        from sel s
        order by s.created_at desc, s.id
        limit v_limit offset v_offset
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
               public.report_user_name(f.by_id) as by_name
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
    select rs.*, public.report_user_name(rs.user_id) as cashier,
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

revoke all on function public.report_user_name(uuid) from public, anon;
revoke all on function public.report_gst(date, date, uuid) from public, anon;
revoke all on function public.report_staff(date, date, uuid) from public, anon;
revoke all on function public.report_stock_movement(date, date, uuid, text, text, integer, integer) from public, anon;
revoke all on function public.report_payment_register(date, date, uuid, text, text, text, integer, integer) from public, anon;
revoke all on function public.report_registers(date, date, uuid, integer, integer) from public, anon;
grant execute on function public.report_user_name(uuid) to authenticated;
grant execute on function public.report_gst(date, date, uuid) to authenticated;
grant execute on function public.report_staff(date, date, uuid) to authenticated;
grant execute on function public.report_stock_movement(date, date, uuid, text, text, integer, integer) to authenticated;
grant execute on function public.report_payment_register(date, date, uuid, text, text, text, integer, integer) to authenticated;
grant execute on function public.report_registers(date, date, uuid, integer, integer) to authenticated;

notify pgrst, 'reload schema';
