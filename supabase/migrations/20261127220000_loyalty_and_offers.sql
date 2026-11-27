-- =====================================================================
-- DailyKart: offers (automatic discounts) and loyalty points
--
-- Loyalty is OFF until a manager turns it on for their store.
-- Points are worked out from what customers buy (less returns) after the
-- store's loyalty start date, minus points already used. No sale code
-- changes: used points are given as a discount on the bill.
--
-- Safe to run more than once. Only ADDS things.
-- =====================================================================

-- Per-store loyalty settings
alter table public.locations add column if not exists loyalty_enabled boolean not null default false;
alter table public.locations add column if not exists loyalty_earn_per_100 numeric(6,2) not null default 1;  -- points per ₹100
alter table public.locations add column if not exists loyalty_point_value numeric(6,2) not null default 1;   -- ₹ per point
alter table public.locations add column if not exists loyalty_min_redeem integer not null default 50;
alter table public.locations add column if not exists loyalty_since timestamptz not null default now();

-- ---------------------------------------------------------------------
-- Offers: a % off on a product, a category or everything, between dates
-- ---------------------------------------------------------------------
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null default public.default_location() references public.locations(id) on delete cascade,
  name text not null,
  percent numeric(5,2) not null check (percent > 0 and percent <= 90),
  product_id uuid references public.products(id) on delete cascade,
  category text,
  min_qty integer not null default 1 check (min_qty >= 1),
  starts_on date,
  ends_on date,
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index if not exists idx_offers_location on public.offers(location_id) where is_active;
alter table public.offers enable row level security;

drop policy if exists "store read offers" on public.offers;
create policy "store read offers" on public.offers for select to authenticated
  using (get_user_role(auth.uid()) = 'admin' or location_id = get_user_location(auth.uid()));
drop policy if exists "manager write offers" on public.offers;
create policy "manager write offers" on public.offers for all to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or (get_user_role(auth.uid()) = 'manager' and location_id = get_user_location(auth.uid())))
  with check (get_user_role(auth.uid()) = 'admin'
              or (get_user_role(auth.uid()) = 'manager' and location_id = get_user_location(auth.uid())));
grant select, insert, update, delete on public.offers to authenticated;

drop trigger if exists trg_set_location_offers on public.offers;
create trigger trg_set_location_offers before insert on public.offers
  for each row execute function public.set_location_from_user();

-- ---------------------------------------------------------------------
-- Loyalty: points used (redeemed) on bills
-- ---------------------------------------------------------------------
create table if not exists public.loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  sale_id uuid references public.sales(id) on delete set null,
  points integer not null check (points > 0),
  value numeric(10,2) not null check (value >= 0),
  location_id uuid not null references public.locations(id) on delete restrict,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_loyalty_redemptions_customer on public.loyalty_redemptions(customer_id);
create unique index if not exists idx_loyalty_redemptions_sale on public.loyalty_redemptions(sale_id) where sale_id is not null;
alter table public.loyalty_redemptions enable row level security;
drop policy if exists "store read loyalty_redemptions" on public.loyalty_redemptions;
create policy "store read loyalty_redemptions" on public.loyalty_redemptions for select to authenticated
  using (get_user_role(auth.uid()) = 'admin' or location_id = get_user_location(auth.uid()));
grant select on public.loyalty_redemptions to authenticated;

-- Points per customer (follows the caller's access to customers and sales)
create or replace view public.customer_loyalty
with (security_invoker = true) as
select
  c.id as customer_id,
  c.location_id,
  coalesce(s.spent, 0) - coalesce(r.returned, 0) as eligible_spend,
  greatest(0, floor((coalesce(s.spent, 0) - coalesce(r.returned, 0)) * l.loyalty_earn_per_100 / 100))::int
    + coalesce(c.loyalty_points, 0) as earned,
  coalesce(u.used, 0) as used,
  greatest(0, floor((coalesce(s.spent, 0) - coalesce(r.returned, 0)) * l.loyalty_earn_per_100 / 100))::int
    + coalesce(c.loyalty_points, 0) - coalesce(u.used, 0) as balance,
  l.loyalty_enabled,
  l.loyalty_point_value,
  l.loyalty_min_redeem
from public.customers c
join public.locations l on l.id = c.location_id
left join lateral (
  select sum(x.total_amount) as spent from public.sales x
  where x.customer_id = c.id and x.created_at >= l.loyalty_since
) s on true
left join lateral (
  select sum(sr.refund_amount) as returned from public.sale_returns sr
  where sr.customer_id = c.id and sr.created_at >= l.loyalty_since
) r on true
left join lateral (
  select sum(lr.points) as used from public.loyalty_redemptions lr where lr.customer_id = c.id
) u on true;
grant select on public.customer_loyalty to authenticated;

-- Records points used on a bill. Checks the balance, and that the bill is
-- this customer's, made by this cashier in the last 30 minutes.
create or replace function public.redeem_loyalty_points(p_sale_id uuid, p_points integer, p_value numeric)
returns public.loyalty_redemptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_sale public.sales;
  v_loc public.locations;
  v_balance int;
  v_row public.loyalty_redemptions;
begin
  if v_user is null then raise exception 'Please sign in again'; end if;
  if coalesce(p_points, 0) <= 0 then raise exception 'Enter the points to use'; end if;

  select * into v_sale from public.sales where id = p_sale_id;
  if not found or v_sale.customer_id is null then raise exception 'Bill not found or has no customer'; end if;
  if v_sale.cashier_id <> v_user and public.get_user_role(v_user) not in ('admin', 'manager') then
    raise exception 'Only the cashier of this bill can use points on it';
  end if;
  if v_sale.created_at < now() - interval '30 minutes' then raise exception 'Points can only be used on a new bill'; end if;

  select * into v_loc from public.locations where id = (select location_id from public.customers where id = v_sale.customer_id);
  if not coalesce(v_loc.loyalty_enabled, false) then raise exception 'Loyalty points are off for this store'; end if;

  -- One customer at a time, so two counters can't spend the same points
  perform pg_advisory_xact_lock(hashtext('loyalty:' || v_sale.customer_id::text));

  -- Points from before this bill (this bill's own points can't pay for it)
  select balance into v_balance from public.customer_loyalty where customer_id = v_sale.customer_id;
  if v_sale.created_at >= v_loc.loyalty_since then
    v_balance := v_balance - floor(coalesce(v_sale.total_amount, 0) * v_loc.loyalty_earn_per_100 / 100)::int;
  end if;
  if coalesce(v_balance, 0) < p_points then
    raise exception 'Only % points available', coalesce(v_balance, 0);
  end if;

  if exists (select 1 from public.loyalty_redemptions where sale_id = v_sale.id) then
    raise exception 'Points were already used on this bill';
  end if;

  insert into public.loyalty_redemptions (customer_id, sale_id, points, value, location_id, created_by)
  values (v_sale.customer_id, v_sale.id, p_points, greatest(0, round(coalesce(p_value, 0), 2)), v_sale.location_id, v_user)
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.redeem_loyalty_points(uuid, integer, numeric) from public, anon;
grant execute on function public.redeem_loyalty_points(uuid, integer, numeric) to authenticated;

notify pgrst, 'reload schema';
