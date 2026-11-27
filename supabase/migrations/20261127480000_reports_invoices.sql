-- =====================================================================
-- DailyKart: Reports Phase 8 — invoice-wise sales.
--   * report_invoices(...): every bill in the dates, one page at a time,
--     searchable by bill number, customer name or phone, filterable by
--     payment method, staff member, customer and status (completed,
--     cancelled, returned, udhaar), with totals for all matching bills.
--   * report_invoice_lines(sale): the lines of one bill, with its returns.
-- Read-only: nothing is stored and no bill is changed. Runs with the
-- caller's own access (row level security applies), needs the Reports
-- permission. India days. Safe to run more than once.
-- =====================================================================

create or replace function public.report_invoices(
  p_from date, p_to date, p_location_id uuid default null,
  p_search text default null, p_method text default null, p_cashier_id uuid default null,
  p_customer_id uuid default null, p_status text default 'all',
  p_sort text default 'date', p_dir text default 'desc',
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
  v_status text := lower(coalesce(p_status, 'all'));
  v_out jsonb;
begin
  if not public.has_perm('reports') then
    raise exception 'Your role doesn''t allow reports';
  end if;
  if v_to - v_from > 750 then
    raise exception 'Pick at most about two years of dates';
  end if;
  v_t0 := v_from::timestamp at time zone 'Asia/Kolkata';
  v_t1 := (v_to + 1)::timestamp at time zone 'Asia/Kolkata';

  with b as (
    select x.id, x.invoice_number, x.created_at, x.customer_id, x.cashier_id, coalesce(x.payment_method, 'cash') as method,
           x.payment_split, coalesce(x.status, 'completed') as status, coalesce(x.is_interstate, false) as interstate,
           x.total_amount as total, coalesce(x.tax_amount, 0) as gst, coalesce(x.discount_amount, 0) as discount,
           coalesce(x.credit_amount, case when x.payment_method = 'credit' then x.total_amount else 0 end) as credit,
           c.name as customer_name, c.phone as customer_phone,
           (select count(*) from public.sale_items i where i.sale_id = x.id) as lines,
           (select coalesce(sum(i.quantity), 0) from public.sale_items i where i.sale_id = x.id) as units,
           (select coalesce(sum(r.refund_amount), 0) from public.sale_returns r where r.sale_id = x.id) as returned
    from public.sales x
    left join public.customers c on c.id = x.customer_id
    where x.created_at >= v_t0 and x.created_at < v_t1
      and (p_location_id is null or x.location_id = p_location_id)
      and (p_method is null or coalesce(x.payment_method, 'cash') = p_method
           or (x.payment_split ? p_method and coalesce((x.payment_split ->> p_method)::numeric, 0) > 0))
      and (p_cashier_id is null or x.cashier_id = p_cashier_id)
      and (p_customer_id is null or x.customer_id = p_customer_id)
      and (v_q is null or x.invoice_number ilike '%' || v_q || '%' or c.name ilike '%' || v_q || '%' or c.phone ilike '%' || v_q || '%')
  ), f as (
    select * from b
    where case v_status
      when 'completed' then status <> 'cancelled'
      when 'cancelled' then status = 'cancelled'
      when 'returned' then returned > 0
      when 'credit' then credit > 0 and status <> 'cancelled'
      else true end
  ), o as (
    select f.*, row_number() over (order by
      case when lower(p_dir) = 'asc' then null else
        case lower(coalesce(p_sort, 'date')) when 'total' then f.total when 'items' then f.units when 'gst' then f.gst
          else extract(epoch from f.created_at)::numeric end end desc nulls last,
      case when lower(p_dir) = 'asc' then
        case lower(coalesce(p_sort, 'date')) when 'total' then f.total when 'items' then f.units when 'gst' then f.gst
          else extract(epoch from f.created_at)::numeric end end asc nulls last,
      f.created_at desc, f.id) as rn
    from f
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'totals', (select jsonb_build_object(
        'bills', count(*) filter (where status <> 'cancelled'),
        'cancelled', count(*) filter (where status = 'cancelled'),
        'billed', round(coalesce(sum(total) filter (where status <> 'cancelled'), 0), 2),
        'taxable', round(coalesce(sum(total - gst) filter (where status <> 'cancelled'), 0), 2),
        'gst', round(coalesce(sum(gst) filter (where status <> 'cancelled'), 0), 2),
        'discount', round(coalesce(sum(discount) filter (where status <> 'cancelled'), 0), 2),
        'credit', round(coalesce(sum(credit) filter (where status <> 'cancelled'), 0), 2),
        'returned', round(coalesce(sum(returned), 0), 2),
        'units', round(coalesce(sum(units) filter (where status <> 'cancelled'), 0), 3),
        'customers', count(distinct customer_id) filter (where status <> 'cancelled'))
      from f),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'invoice_number', o.invoice_number, 'created_at', o.created_at,
        'customer_id', o.customer_id, 'customer_name', o.customer_name, 'phone', o.customer_phone,
        'cashier', coalesce(public.report_user_name(o.cashier_id), case when o.cashier_id is null then null else 'Unnamed staff' end),
        'method', o.method, 'payment_split', o.payment_split, 'status', o.status, 'interstate', o.interstate,
        'lines', o.lines, 'units', round(o.units, 3), 'taxable', round(o.total - o.gst, 2), 'gst', round(o.gst, 2),
        'discount', round(o.discount, 2), 'billed', round(o.total, 2), 'credit', round(o.credit, 2), 'returned', round(o.returned, 2))
        order by o.rn)
      from o where o.rn > v_offset and o.rn <= v_offset + v_limit), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

create or replace function public.report_invoice_lines(p_sale_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.has_perm('reports') then
    raise exception 'Your role doesn''t allow reports';
  end if;
  return jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', coalesce(i.product_name, p.name, 'Item'), 'sku', coalesce(i.sku, p.sku), 'hsn', coalesce(i.hsn_code, p.hsn_code),
        'qty', i.quantity, 'unit_price', i.unit_price, 'discount_pct', coalesce(i.discount_percent, 0),
        'gst_rate', coalesce(i.gst_rate, 0), 'gst', coalesce(i.gst_amount, 0),
        'taxable', round(i.total_price - coalesce(i.gst_amount, 0), 2), 'total', i.total_price,
        'returned_qty', (select coalesce(sum(ri.quantity), 0) from public.sale_return_items ri where ri.sale_item_id = i.id)) order by i.id)
      from public.sale_items i left join public.products p on p.id = i.product_id where i.sale_id = p_sale_id), '[]'::jsonb),
    'returns', coalesce((
      select jsonb_agg(jsonb_build_object('return_number', r.return_number, 'created_at', r.created_at, 'refund_method', r.refund_method,
                                          'refund_amount', r.refund_amount, 'reason', r.reason) order by r.created_at)
      from public.sale_returns r where r.sale_id = p_sale_id), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.report_invoices(date, date, uuid, text, text, uuid, uuid, text, text, text, integer, integer) from public, anon;
revoke all on function public.report_invoice_lines(uuid) from public, anon;
grant execute on function public.report_invoices(date, date, uuid, text, text, uuid, uuid, text, text, text, integer, integer) to authenticated;
grant execute on function public.report_invoice_lines(uuid) to authenticated;

notify pgrst, 'reload schema';
