-- =====================================================================
-- DailyKart: alerts, owner snapshot and loyalty points history
--   * owner_alerts: one list of things that need attention (low stock,
--     expiring batches, overdue udhaar and supplier bills, expenses
--     waiting for approval, orders waiting, till not closed, cash short,
--     attendance not marked). Worked out live, each only for people whose
--     role can open that part of the app.
--   * owner_snapshot: today vs yesterday vs last week, month so far,
--     gross profit today, udhaar to collect, supplier dues, stock value,
--     and a per-store row for the owner.
--   * loyalty_ledger: points earned, taken back by returns, and used,
--     bill by bill, for one customer.
-- Read-only functions. Nothing is stored. Safe to run more than once.
-- =====================================================================

create or replace function public.owner_alerts(p_location_id uuid default null)
returns table (kind text, severity text, title text, detail text, item_count integer, link text)
language plpgsql stable security invoker set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_n integer;
  v_amt numeric;
  v_txt text;
begin
  -- stock
  if public.has_perm('stock') or public.has_perm('products') then
    select count(*), string_agg(name, ', ' order by stock_quantity) filter (where rn <= 3) into v_n, v_txt
    from (select name, stock_quantity, row_number() over (order by stock_quantity) rn
          from public.products
          where coalesce(is_active, true) and min_stock_level is not null and min_stock_level > 0
            and stock_quantity <= min_stock_level and (p_location_id is null or location_id = p_location_id)) x;
    if v_n > 0 then
      kind := 'low_stock'; severity := 'warning'; title := v_n || ' product' || case when v_n > 1 then 's' else '' end || ' running low';
      detail := v_txt || case when v_n > 3 then ' and more' else '' end; item_count := v_n; link := '/stock'; return next;
    end if;

    select count(*) into v_n from public.product_batches b
    where b.cleared_at is null and b.quantity > 0 and b.expiry_date is not null and b.expiry_date <= v_today + 7
      and (p_location_id is null or b.location_id = p_location_id);
    if v_n > 0 then
      kind := 'expiry'; severity := case when exists (select 1 from public.product_batches b where b.cleared_at is null and b.quantity > 0
                                                       and b.expiry_date < v_today and (p_location_id is null or b.location_id = p_location_id))
                                         then 'danger' else 'warning' end;
      title := v_n || ' batch' || case when v_n > 1 then 'es' else '' end || ' expired or expiring this week';
      detail := 'Sell first, return to the supplier or write off'; item_count := v_n; link := '/stock'; return next;
    end if;
  end if;

  -- udhaar
  if public.has_perm('khata') then
    select count(*), sum(balance) into v_n, v_amt from public.customer_balances
    where balance > 0 and credit_days is not null and oldest_due_at is not null
      and oldest_due_at + make_interval(days => credit_days) < now()
      and (p_location_id is null or location_id = p_location_id);
    if v_n > 0 then
      kind := 'udhaar_overdue'; severity := 'warning'; title := v_n || ' customer' || case when v_n > 1 then 's' else '' end || ' overdue on udhaar';
      detail := '₹' || to_char(v_amt, 'FM99,99,99,990') || ' to collect'; item_count := v_n; link := '/khata'; return next;
    end if;
  end if;

  -- suppliers
  if public.has_perm('purchases') or public.has_perm('accounts') then
    select count(*), sum(balance) into v_n, v_amt from public.supplier_balances
    where balance > 0 and credit_days is not null and oldest_due_at is not null
      and oldest_due_at + make_interval(days => credit_days) < now() + interval '3 days'
      and (p_location_id is null or location_id = p_location_id);
    if v_n > 0 then
      kind := 'supplier_due'; severity := 'info'; title := v_n || ' supplier bill' || case when v_n > 1 then 's' else '' end || ' due';
      detail := '₹' || to_char(v_amt, 'FM99,99,99,990') || ' due now or in the next 3 days'; item_count := v_n; link := '/purchases'; return next;
    end if;
  end if;

  -- expenses waiting
  if public.get_user_role(auth.uid()) in ('admin', 'manager', 'accountant') then
    select count(*), sum(amount) into v_n, v_amt from public.expenses
    where status = 'pending' and (p_location_id is null or location_id = p_location_id);
    if v_n > 0 then
      kind := 'expense_approval'; severity := 'info'; title := v_n || ' expense' || case when v_n > 1 then 's' else '' end || ' waiting for approval';
      detail := '₹' || to_char(v_amt, 'FM99,99,99,990'); item_count := v_n; link := '/expenses'; return next;
    end if;
  end if;

  -- orders
  if public.has_perm('sales') then
    select count(*) into v_n from public.customer_orders
    where status = 'new' and created_at < now() - interval '20 minutes' and (p_location_id is null or location_id = p_location_id);
    if v_n > 0 then
      kind := 'orders_waiting'; severity := 'danger'; title := v_n || ' order' || case when v_n > 1 then 's' else '' end || ' not started';
      detail := 'Waiting more than 20 minutes'; item_count := v_n; link := '/orders'; return next;
    end if;
    select count(*) into v_n from public.customer_orders
    where status not in ('delivered', 'cancelled') and expected_at is not null and expected_at < now()
      and (p_location_id is null or location_id = p_location_id);
    if v_n > 0 then
      kind := 'orders_late'; severity := 'warning'; title := v_n || ' order' || case when v_n > 1 then 's' else '' end || ' past the promised time';
      detail := null; item_count := v_n; link := '/orders'; return next;
    end if;
  end if;

  -- till
  if public.has_perm('register') and public.get_user_role(auth.uid()) in ('admin', 'manager') then
    select count(*) into v_n from public.register_sessions
    where closed_at is null and (opened_at at time zone 'Asia/Kolkata')::date < v_today
      and (p_location_id is null or location_id = p_location_id);
    if v_n > 0 then
      kind := 'till_open'; severity := 'warning'; title := v_n || ' till' || case when v_n > 1 then 's' else '' end || ' left open from an earlier day';
      detail := 'Close it on Day closing'; item_count := v_n; link := '/register'; return next;
    end if;
    select count(*), sum(difference) into v_n, v_amt from public.register_sessions
    where closed_at >= now() - interval '2 days' and difference < -50
      and (p_location_id is null or location_id = p_location_id);
    if v_n > 0 then
      kind := 'cash_short'; severity := 'danger'; title := 'Cash short at closing';
      detail := '₹' || to_char(-v_amt, 'FM99,99,99,990') || ' short in the last 2 days'; item_count := v_n; link := '/register'; return next;
    end if;
  end if;

  -- attendance (after 11 am)
  if public.has_perm('staff') and (now() at time zone 'Asia/Kolkata')::time > time '11:00' then
    select count(*) into v_n from public.staff s
    where s.is_active and (s.weekly_off is null or s.weekly_off <> extract(dow from v_today))
      and (p_location_id is null or s.location_id = p_location_id)
      and not exists (select 1 from public.attendance a where a.staff_id = s.id and a.date = v_today);
    if v_n > 0 then
      kind := 'attendance'; severity := 'info'; title := 'Attendance not marked for ' || v_n || ' staff';
      detail := null; item_count := v_n; link := '/staff'; return next;
    end if;
  end if;
end;
$$;
grant execute on function public.owner_alerts(uuid) to authenticated;

-- ---------- Owner snapshot (follows the caller's access)
create or replace function public.owner_snapshot(p_location_id uuid default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  with d as (
    select (now() at time zone 'Asia/Kolkata')::date as today,
           ((now() at time zone 'Asia/Kolkata') - interval '1 day')::date as yday,
           ((now() at time zone 'Asia/Kolkata') - interval '7 day')::date as lastweek,
           date_trunc('month', now() at time zone 'Asia/Kolkata')::date as m0,
           (date_trunc('month', now() at time zone 'Asia/Kolkata') - interval '1 month')::date as pm0,
           (now() at time zone 'Asia/Kolkata' - interval '1 month')::date as pm_same
  ), s as (
    select x.location_id, (x.created_at at time zone 'Asia/Kolkata')::date as day,
           coalesce(x.total_amount, 0) as total, coalesce(x.tax_amount, 0) as tax
    from public.sales x, d
    where coalesce(x.status, 'completed') <> 'cancelled'
      and x.created_at >= (d.pm0::timestamp at time zone 'Asia/Kolkata')
      and (p_location_id is null or x.location_id = p_location_id)
  ), cogs as (
    select coalesce(sum(-m.quantity_change * coalesce(m.unit_cost, 0)), 0) as amt
    from public.stock_movements m, d
    where m.movement_type = 'sale' and (m.created_at at time zone 'Asia/Kolkata')::date = d.today
      and (p_location_id is null or m.location_id = p_location_id)
  )
  select jsonb_build_object(
    'today', (select coalesce(sum(total), 0) from s, d where day = d.today),
    'today_bills', (select count(*) from s, d where day = d.today),
    'yesterday', (select coalesce(sum(total), 0) from s, d where day = d.yday),
    'last_week_same_day', (select coalesce(sum(total), 0) from s, d where day = d.lastweek),
    'month', (select coalesce(sum(total), 0) from s, d where day >= d.m0),
    'last_month_same_period', (select coalesce(sum(total), 0) from s, d where day >= d.pm0 and day <= d.pm_same),
    'gross_profit_today', (select round(coalesce(sum(total - tax), 0) - (select amt from cogs), 2) from s, d where day = d.today),
    'udhaar_due', (select coalesce(sum(balance), 0) from public.customer_balances where balance > 0 and (p_location_id is null or location_id = p_location_id)),
    'supplier_due', (select coalesce(sum(balance), 0) from public.supplier_balances where balance > 0 and (p_location_id is null or location_id = p_location_id)),
    'stock_value', (select round(coalesce(sum(greatest(stock_quantity, 0) * coalesce(cost_price, 0)), 0), 2) from public.products
                    where coalesce(is_active, true) and (p_location_id is null or location_id = p_location_id)),
    'stores', (select coalesce(jsonb_agg(jsonb_build_object('location_id', l.id, 'name', l.name,
                        'today', (select coalesce(sum(total), 0) from s, d where s.location_id = l.id and day = d.today),
                        'month', (select coalesce(sum(total), 0) from s, d where s.location_id = l.id and day >= d.m0)) order by l.name), '[]'::jsonb)
               from public.locations l
               where (p_location_id is null or l.id = p_location_id)
                 and (public.get_user_role(auth.uid()) = 'admin' or l.id = public.get_user_location(auth.uid())))
  )
$$;
grant execute on function public.owner_snapshot(uuid) to authenticated;

-- ---------- Loyalty points history for one customer (newest first)
create or replace function public.loyalty_ledger(p_customer_id uuid)
returns table (at timestamptz, kind text, ref text, amount numeric, points integer)
language sql stable security invoker set search_path = public as $$
  with c as (
    select c.id, c.loyalty_points, c.created_at, l.loyalty_earn_per_100 as rate, l.loyalty_since
    from public.customers c join public.locations l on l.id = c.location_id
    where c.id = p_customer_id
  )
  select * from (
    select c.created_at, 'opening'::text, null::text, null::numeric, c.loyalty_points from c where coalesce(c.loyalty_points, 0) <> 0
    union all
    select x.created_at, 'earned', x.invoice_number, x.total_amount, floor(x.total_amount * c.rate / 100)::int
    from public.sales x, c where x.customer_id = c.id and x.created_at >= c.loyalty_since
    union all
    select r.created_at, 'returned', r.return_number, r.refund_amount, -floor(r.refund_amount * c.rate / 100)::int
    from public.sale_returns r, c where r.customer_id = c.id and r.created_at >= c.loyalty_since
    union all
    select lr.created_at, 'used', s.invoice_number, lr.value, -lr.points
    from public.loyalty_redemptions lr cross join c left join public.sales s on s.id = lr.sale_id where lr.customer_id = c.id
  ) t(at, kind, ref, amount, points)
  where points <> 0
  order by at desc
  limit 500
$$;
grant execute on function public.loyalty_ledger(uuid) to authenticated;

notify pgrst, 'reload schema';
