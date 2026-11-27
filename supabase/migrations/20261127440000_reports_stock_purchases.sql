-- Reports Phase 4: stock, movers, expiry, stock movement and purchase reports.
-- Read-only. Nothing here changes a table, a bill or an existing function.
-- Same rules as the other report_* functions: SECURITY INVOKER (row security applies),
-- needs the Reports permission, India days, stock valued at the saved cost.

-- ---------- Stock on hand, value and how fast each product sells
-- status: all | in | low | out | dead | fast | slow
-- sort: value | stock | sold | cover | last_sold | name ; dir: desc | asc
-- Movement class over the chosen dates, among active products:
--   dead = in stock but none sold; fast = top 20% by units sold; slow = bottom 30% of products that sold.
create or replace function public.report_inventory(
  p_from date, p_to date, p_location_id uuid default null,
  p_category text default null, p_search text default null, p_status text default 'all',
  p_sort text default 'value', p_dir text default 'desc',
  p_limit integer default 25, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_from date := least(p_from, p_to);
  v_to date := greatest(p_from, p_to);
  v_days integer;
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(trim(coalesce(p_search, '')), '');
  v_status text := lower(coalesce(p_status, 'all'));
  v_sort text := lower(coalesce(p_sort, 'value'));
  v_asc boolean := lower(coalesce(p_dir, 'desc')) = 'asc';
  v_out jsonb;
begin
  if not public.has_perm('reports') then
    raise exception 'Your role doesn''t allow reports';
  end if;
  if v_status not in ('all', 'in', 'low', 'out', 'dead', 'fast', 'slow') then
    raise exception 'Unknown stock filter: %', p_status;
  end if;
  v_days := v_to - v_from + 1;
  v_t0 := v_from::timestamp at time zone 'Asia/Kolkata';
  v_t1 := (v_to + 1)::timestamp at time zone 'Asia/Kolkata';

  with p as (
    select id, name, sku, barcode, category, location_id,
           coalesce(stock_quantity, 0) as stock, coalesce(min_stock_level, 0) as min_level,
           coalesce(cost_price, 0) as cost, price, mrp,
           coalesce(mrp, price * (1 + coalesce(gst_rate, 0) / 100), 0) as mrp_value_each
    from public.products
    where coalesce(is_active, true)
      and (p_location_id is null or location_id = p_location_id)
  ), sold as (
    select i.product_id, sum(i.quantity) as units, sum(i.total_price - coalesce(i.gst_amount, 0)) as revenue
    from public.sale_items i
    join public.sales x on x.id = i.sale_id
    where x.created_at >= v_t0 and x.created_at < v_t1
      and coalesce(x.status, 'completed') <> 'cancelled'
      and (p_location_id is null or x.location_id = p_location_id)
    group by i.product_id
  ), ret as (
    select i.product_id, sum(i.quantity) as units
    from public.sale_return_items i
    join public.sale_returns x on x.id = i.return_id
    where x.created_at >= v_t0 and x.created_at < v_t1
      and (p_location_id is null or x.location_id = p_location_id)
    group by i.product_id
  ), last_mv as (
    select m.product_id,
           max(m.created_at) filter (where m.movement_type = 'sale') as last_sold_at,
           max(m.created_at) filter (where m.movement_type = 'purchase') as last_purchased_at
    from public.stock_movements m
    where m.movement_type in ('sale', 'purchase')
      and (p_location_id is null or m.location_id = p_location_id)
    group by m.product_id
  ), base as (
    select p.*, coalesce(s.units, 0) as sold_units, coalesce(r.units, 0) as returned_units,
           coalesce(s.units, 0) - coalesce(r.units, 0) as net_units,
           coalesce(s.revenue, 0) as revenue,
           lm.last_sold_at, lm.last_purchased_at,
           greatest(p.stock, 0) * p.cost as value_cost,
           greatest(p.stock, 0) * p.mrp_value_each as value_mrp,
           case when p.stock <= 0 then 'out' when p.stock <= p.min_level then 'low' else 'ok' end as stock_status
    from p
    left join sold s on s.product_id = p.id
    left join ret r on r.product_id = p.id
    left join last_mv lm on lm.product_id = p.id
  ), ranked as (
    select b.*,
           case when b.sold_units > 0 then percent_rank() over (partition by (b.sold_units > 0) order by b.sold_units desc) end as pr
    from base b
  ), calc as (
    select r.*,
           round(greatest(r.net_units, 0) / v_days, 3) as avg_daily,
           case when r.net_units > 0 and r.stock > 0 then round(r.stock / (r.net_units / v_days), 1) end as days_cover,
           case when r.sold_units <= 0 and r.stock > 0 then 'dead'
                when r.sold_units <= 0 then 'none'
                when r.pr <= 0.2 then 'fast'
                when r.pr >= 0.7 then 'slow'
                else 'normal' end as movement
    from ranked r
  ), f as (
    select * from calc c
    where (p_category is null or c.category = p_category)
      and (v_q is null or c.name ilike '%' || v_q || '%' or c.sku ilike v_q || '%' or c.barcode = v_q)
  ), sel as (
    select * from f
    where v_status = 'all'
       or (v_status = 'in' and f.stock > 0)
       or (v_status = 'low' and f.stock_status = 'low')
       or (v_status = 'out' and f.stock_status = 'out')
       or (v_status = f.movement)
  )
  select jsonb_build_object(
    'days', v_days,
    'total', (select count(*) from sel),
    'totals', (select jsonb_build_object(
        'skus', count(*), 'stock_units', round(coalesce(sum(greatest(stock, 0)), 0), 3),
        'value_cost', round(coalesce(sum(value_cost), 0), 2), 'value_mrp', round(coalesce(sum(value_mrp), 0), 2),
        'out_of_stock', count(*) filter (where stock_status = 'out'), 'low_stock', count(*) filter (where stock_status = 'low'),
        'dead', count(*) filter (where movement = 'dead'), 'dead_value', round(coalesce(sum(value_cost) filter (where movement = 'dead'), 0), 2),
        'fast', count(*) filter (where movement = 'fast'), 'slow', count(*) filter (where movement = 'slow'),
        'negative_stock', count(*) filter (where stock < 0),
        'sold_units', round(coalesce(sum(sold_units), 0), 3))
      from f),
    'categories', coalesce((
      select jsonb_agg(c order by (c->>'value_cost')::numeric desc) from (
        select jsonb_build_object('key', coalesce(category, ''), 'label', coalesce(nullif(category, ''), 'No category'),
                                  'skus', count(*), 'stock_units', round(sum(greatest(stock, 0)), 3),
                                  'value_cost', round(sum(value_cost), 2), 'value_mrp', round(sum(value_mrp), 2),
                                  'dead_value', round(coalesce(sum(value_cost) filter (where movement = 'dead'), 0), 2),
                                  'sold_units', round(sum(sold_units), 3)) as c
        from f group by category
      ) z), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(t) - 'ord') from (
        select s.id as product_id, s.name, s.sku, s.barcode, s.category,
               round(s.stock, 3) as stock, s.min_level, s.cost, s.price, s.mrp,
               round(s.value_cost, 2) as value_cost, round(s.value_mrp, 2) as value_mrp,
               round(s.sold_units, 3) as sold_units, round(s.returned_units, 3) as returned_units,
               round(s.revenue, 2) as revenue, s.avg_daily, s.days_cover,
               s.last_sold_at, s.last_purchased_at,
               case when s.last_sold_at is not null
                    then (now() at time zone 'Asia/Kolkata')::date - (s.last_sold_at at time zone 'Asia/Kolkata')::date end as days_since_sale,
               s.stock_status, s.movement,
               row_number() over (order by
                 case when not v_asc then
                   case v_sort when 'stock' then s.stock when 'sold' then s.sold_units when 'cover' then s.days_cover
                     when 'last_sold' then extract(epoch from s.last_sold_at)::numeric else s.value_cost end end desc nulls last,
                 case when v_asc then
                   case v_sort when 'stock' then s.stock when 'sold' then s.sold_units when 'cover' then s.days_cover
                     when 'last_sold' then extract(epoch from s.last_sold_at)::numeric else s.value_cost end end asc nulls last,
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

-- ---------- Batches that have expired or will expire within p_days
-- Quantity still on the shelf per batch is an estimate: it assumes the earliest expiry is sold first,
-- so the current stock belongs to the latest-expiring batches.
create or replace function public.report_expiry(
  p_location_id uuid default null, p_days integer default 90, p_search text default null,
  p_limit integer default 25, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_days integer := least(greatest(coalesce(p_days, 90), 0), 730);
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(trim(coalesce(p_search, '')), '');
  v_out jsonb;
begin
  if not public.has_perm('reports') then
    raise exception 'Your role doesn''t allow reports';
  end if;

  with b as (
    select pb.id, pb.product_id, pb.batch_no, pb.expiry_date, pb.quantity, pb.created_at,
           p.name, p.sku, p.barcode, p.category, greatest(coalesce(p.stock_quantity, 0), 0) as stock,
           coalesce(p.cost_price, 0) as cost, coalesce(p.mrp, p.price * (1 + coalesce(p.gst_rate, 0) / 100), 0) as mrp_each,
           coalesce(sum(pb.quantity) over (partition by pb.product_id order by pb.expiry_date desc nulls first, pb.created_at desc
                                           rows between unbounded preceding and 1 preceding), 0) as later_qty
    from public.product_batches pb
    join public.products p on p.id = pb.product_id
    where pb.cleared_at is null and pb.expiry_date is not null
      and (p_location_id is null or pb.location_id = p_location_id)
  ), e as (
    select b.*, b.expiry_date - v_today as days_left,
           least(b.quantity, greatest(b.stock - b.later_qty, 0)) as qty_left
    from b
    where b.expiry_date <= v_today + v_days
      and (v_q is null or b.name ilike '%' || v_q || '%' or b.sku ilike v_q || '%' or b.barcode = v_q or b.batch_no ilike v_q || '%')
  ), c as (
    select e.*, e.qty_left * e.cost as value_cost, e.qty_left * e.mrp_each as value_mrp,
           case when e.days_left < 0 then 'expired' when e.days_left <= 7 then 'd0_7' when e.days_left <= 30 then 'd8_30'
                when e.days_left <= 60 then 'd31_60' when e.days_left <= 90 then 'd61_90' else 'd90_plus' end as bucket
    from e
  )
  select jsonb_build_object(
    'as_of', v_today,
    'days', v_days,
    'total', (select count(*) from c),
    'totals', (select jsonb_build_object('batches', count(*), 'qty_left', round(coalesce(sum(qty_left), 0), 3),
                                         'value_cost', round(coalesce(sum(value_cost), 0), 2),
                                         'value_mrp', round(coalesce(sum(value_mrp), 0), 2),
                                         'empty_batches', count(*) filter (where qty_left <= 0)) from c),
    'buckets', (select coalesce(jsonb_agg(jsonb_build_object('key', k.key, 'label', k.label,
                                  'batches', coalesce(x.n, 0), 'qty_left', round(coalesce(x.q, 0), 3),
                                  'value_cost', round(coalesce(x.v, 0), 2)) order by k.ord), '[]'::jsonb)
                from (values (1, 'expired', 'Expired'), (2, 'd0_7', '0–7 days'), (3, 'd8_30', '8–30 days'),
                             (4, 'd31_60', '31–60 days'), (5, 'd61_90', '61–90 days'), (6, 'd90_plus', 'Over 90 days')) k(ord, key, label)
                left join (select bucket, count(*) as n, sum(qty_left) as q, sum(value_cost) as v from c group by bucket) x on x.bucket = k.key
                where k.key <> 'd90_plus' or v_days > 90),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select c.id as batch_id, c.product_id, c.name, c.sku, c.category, c.batch_no, c.expiry_date, c.days_left, c.bucket,
               round(c.quantity, 3) as batch_qty, round(c.stock, 3) as stock, round(c.qty_left, 3) as qty_left,
               c.cost, round(c.value_cost, 2) as value_cost, round(c.value_mrp, 2) as value_mrp
        from c
        order by c.expiry_date, c.name, c.id
        limit v_limit offset v_offset
      ) t), '[]'::jsonb)
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
               (select pr.full_name from public.profiles pr where pr.id = s.created_by) as by_name
        from sel s
        order by s.created_at desc, s.id
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
                    where sp.created_at >= v_t0 and sp.created_at < v_t1
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
      where sp.created_at >= v_t0 and sp.created_at < v_t1
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

revoke all on function public.report_inventory(date, date, uuid, text, text, text, text, text, integer, integer) from public, anon;
revoke all on function public.report_expiry(uuid, integer, text, integer, integer) from public, anon;
revoke all on function public.report_stock_movement(date, date, uuid, text, text, integer, integer) from public, anon;
revoke all on function public.report_purchases(date, date, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.report_inventory(date, date, uuid, text, text, text, text, text, integer, integer) to authenticated;
grant execute on function public.report_expiry(uuid, integer, text, integer, integer) to authenticated;
grant execute on function public.report_stock_movement(date, date, uuid, text, text, integer, integer) to authenticated;
grant execute on function public.report_purchases(date, date, uuid, text, text, integer, integer) to authenticated;

notify pgrst, 'reload schema';
