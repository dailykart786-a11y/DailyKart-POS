-- =====================================================================
-- DailyKart: billing upgrade
--   * more offer types: flat Rs off, Buy X Get Y free, minimum bill value
--   * coupons with use limits
--   * most a cashier may discount, and manager approval by PIN above it
--   * bank transfer as a payment method
--   * best sellers for the quick-pick buttons
-- Only adds things. Safe to run more than once.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- Offer types
alter table public.offers add column if not exists offer_type text not null default 'percent';
alter table public.offers add column if not exists flat_amount numeric(10,2);
alter table public.offers add column if not exists buy_qty integer;
alter table public.offers add column if not exists get_qty integer;
alter table public.offers add column if not exists min_bill numeric(12,2);
alter table public.offers alter column percent drop not null;
alter table public.offers drop constraint if exists offers_percent_check;
alter table public.offers drop constraint if exists offers_type_ok;
alter table public.offers add constraint offers_type_ok check (
  (offer_type = 'percent' and percent > 0 and percent <= 90)
  or (offer_type = 'flat' and flat_amount > 0)
  or (offer_type = 'bxgy' and buy_qty >= 1 and get_qty >= 1)
);
alter table public.offers drop constraint if exists offers_min_bill_ok;
alter table public.offers add constraint offers_min_bill_ok check (min_bill is null or min_bill >= 0);

-- ---------- Discount limit per store (null = no limit)
alter table public.locations add column if not exists max_discount_pct numeric(5,2);
do $$ begin
  alter table public.locations add constraint locations_max_discount_ok check (max_discount_pct is null or (max_discount_pct >= 0 and max_discount_pct <= 100));
exception when duplicate_object then null; end $$;

-- ---------- Manager PIN for approving bigger discounts
create table if not exists public.manager_pins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.manager_pins enable row level security;
-- nobody reads hashes directly; functions below do the work
revoke all on public.manager_pins from anon, authenticated;
grant all on public.manager_pins to service_role;

create table if not exists public.pin_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists idx_pin_attempts_user on public.pin_attempts(user_id, at);
alter table public.pin_attempts enable row level security;
revoke all on public.pin_attempts from anon, authenticated;

create table if not exists public.discount_approvals (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id) on delete restrict,
  sale_id uuid references public.sales(id) on delete set null,
  requested_by uuid not null default auth.uid() references auth.users(id),
  approved_by uuid not null references auth.users(id),
  percent numeric(6,2),
  amount numeric(12,2),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_discount_approvals_location on public.discount_approvals(location_id, created_at);
alter table public.discount_approvals enable row level security;
drop policy if exists "read discount_approvals" on public.discount_approvals;
create policy "read discount_approvals" on public.discount_approvals for select to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or requested_by = auth.uid()
         or ((has_perm('audit') or get_user_role(auth.uid()) = 'manager') and location_id = get_user_location(auth.uid())));
grant select on public.discount_approvals to authenticated;
grant all on public.discount_approvals to service_role;

create or replace function public.set_my_pin(p_pin text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if public.get_user_role(auth.uid()) not in ('admin', 'manager') then
    raise exception 'Only managers and admins have an approval PIN';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then raise exception 'PIN must be 4 to 6 digits'; end if;
  insert into public.manager_pins (user_id, pin_hash, updated_at)
  values (auth.uid(), crypt(p_pin, gen_salt('bf')), now())
  on conflict (user_id) do update set pin_hash = excluded.pin_hash, updated_at = now();
  return true;
end;
$$;
grant execute on function public.set_my_pin(text) to authenticated;

create or replace function public.has_my_pin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.manager_pins where user_id = auth.uid())
$$;
grant execute on function public.has_my_pin() to authenticated;

-- A manager or admin of this store types their PIN on the till.
-- Returns the approval id (null for a wrong PIN), which is linked to the bill after it is saved.
create or replace function public.approve_discount(p_pin text, p_percent numeric, p_amount numeric default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_loc uuid := public.get_user_location(auth.uid());
  v_approver uuid;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if (select count(*) from public.pin_attempts where user_id = auth.uid() and at > now() - interval '10 minutes') >= 5 then
    raise exception 'Too many wrong PINs. Wait 10 minutes.';
  end if;
  select mp.user_id into v_approver
  from public.manager_pins mp
  join public.user_roles ur on ur.user_id = mp.user_id
  where mp.pin_hash = crypt(coalesce(p_pin, ''), mp.pin_hash)
    and (ur.role = 'admin' or (ur.role = 'manager' and public.get_user_location(mp.user_id) = v_loc))
  limit 1;
  if v_approver is null then
    -- no error here, so the failed try is kept and counted
    insert into public.pin_attempts (user_id) values (auth.uid());
    return null;
  end if;
  insert into public.discount_approvals (location_id, requested_by, approved_by, percent, amount, note)
  values (v_loc, auth.uid(), v_approver, round(p_percent, 2), round(p_amount, 2), nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.approve_discount(text, numeric, numeric, text) to authenticated;

create or replace function public.attach_discount_approval(p_approval_id uuid, p_sale_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.discount_approvals set sale_id = p_sale_id
  where id = p_approval_id and requested_by = auth.uid() and sale_id is null
    and exists (select 1 from public.sales s where s.id = p_sale_id and s.cashier_id = auth.uid());
  return found;
end;
$$;
grant execute on function public.attach_discount_approval(uuid, uuid) to authenticated;

-- ---------- Coupons
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null default public.default_location() references public.locations(id) on delete cascade,
  code text not null,
  kind text not null default 'percent' check (kind in ('percent', 'flat')),
  value numeric(10,2) not null check (value > 0),
  min_bill numeric(12,2),
  max_uses integer check (max_uses is null or max_uses > 0),
  starts_on date,
  ends_on date,
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (kind <> 'percent' or value <= 90),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create unique index if not exists uq_coupons_store_code on public.coupons(location_id, upper(code));
alter table public.coupons enable row level security;
drop policy if exists "store read coupons" on public.coupons;
create policy "store read coupons" on public.coupons for select to authenticated
  using (get_user_role(auth.uid()) = 'admin' or location_id = get_user_location(auth.uid()));
drop policy if exists "manager write coupons" on public.coupons;
create policy "manager write coupons" on public.coupons for all to authenticated
  using (get_user_role(auth.uid()) = 'admin' or (has_perm('offers') and location_id = get_user_location(auth.uid())))
  with check (get_user_role(auth.uid()) = 'admin' or (has_perm('offers') and location_id = get_user_location(auth.uid())));
grant select, insert, update, delete on public.coupons to authenticated;
grant all on public.coupons to service_role;

create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete restrict,
  sale_id uuid not null unique references public.sales(id) on delete cascade,
  location_id uuid references public.locations(id),
  discount numeric(12,2),
  used_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_coupon_redemptions_coupon on public.coupon_redemptions(coupon_id);
alter table public.coupon_redemptions enable row level security;
drop policy if exists "store read coupon_redemptions" on public.coupon_redemptions;
create policy "store read coupon_redemptions" on public.coupon_redemptions for select to authenticated
  using (get_user_role(auth.uid()) = 'admin' or location_id = get_user_location(auth.uid()));
grant select on public.coupon_redemptions to authenticated;
grant all on public.coupon_redemptions to service_role;

-- Is this code usable on a bill of this amount? Returns the coupon or raises why not.
create or replace function public.check_coupon(p_code text, p_bill_total numeric)
returns public.coupons language plpgsql stable security definer set search_path = public as $$
declare
  v public.coupons;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_used integer;
begin
  select * into v from public.coupons
  where upper(code) = upper(trim(coalesce(p_code, '')))
    and (location_id = public.get_user_location(auth.uid()) or public.get_user_role(auth.uid()) = 'admin')
  order by (location_id = public.get_user_location(auth.uid())) desc
  limit 1;
  if v.id is null then raise exception 'No such coupon'; end if;
  if not v.is_active then raise exception 'This coupon is switched off'; end if;
  if v.starts_on is not null and v.starts_on > v_today then raise exception 'This coupon starts on %', to_char(v.starts_on, 'DD Mon YYYY'); end if;
  if v.ends_on is not null and v.ends_on < v_today then raise exception 'This coupon ended on %', to_char(v.ends_on, 'DD Mon YYYY'); end if;
  if v.min_bill is not null and coalesce(p_bill_total, 0) < v.min_bill then
    raise exception 'This coupon needs a bill of at least Rs %', to_char(v.min_bill, 'FM999999990.00');
  end if;
  if v.max_uses is not null then
    select count(*) into v_used from public.coupon_redemptions where coupon_id = v.id;
    if v_used >= v.max_uses then raise exception 'This coupon has been used up'; end if;
  end if;
  return v;
end;
$$;
grant execute on function public.check_coupon(text, numeric) to authenticated;

-- Records the use after the bill is saved
create or replace function public.redeem_coupon(p_coupon_id uuid, p_sale_id uuid, p_discount numeric)
returns public.coupon_redemptions language plpgsql security definer set search_path = public as $$
declare
  v public.coupons;
  v_sale public.sales;
  v_row public.coupon_redemptions;
begin
  select * into v from public.coupons where id = p_coupon_id for update;
  if v.id is null then raise exception 'No such coupon'; end if;
  select * into v_sale from public.sales where id = p_sale_id;
  if v_sale.id is null or v_sale.cashier_id is distinct from auth.uid() then raise exception 'Bill not found'; end if;
  if v.max_uses is not null and (select count(*) from public.coupon_redemptions where coupon_id = v.id) >= v.max_uses then
    raise exception 'This coupon has been used up';
  end if;
  insert into public.coupon_redemptions (coupon_id, sale_id, location_id, discount)
  values (v.id, p_sale_id, v_sale.location_id, round(p_discount, 2))
  on conflict (sale_id) do nothing
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.redeem_coupon(uuid, uuid, numeric) to authenticated;

-- ---------- Bank transfer: allowed as a part of a split payment
-- (a bill paid fully by bank transfer is saved as a split of one part)
create or replace function public.create_sale_split(
  p_items jsonb,
  p_payments jsonb,
  p_customer_id uuid default null,
  p_location_id uuid default null
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales;
  v_key text;
  v_val numeric;
  v_sum numeric := 0;
  v_clean jsonb := '{}'::jsonb;
  v_credit numeric := 0;
begin
  if p_payments is null or jsonb_typeof(p_payments) <> 'object' then
    raise exception 'Enter how much was paid each way';
  end if;
  for v_key, v_val in select key, value::text::numeric from jsonb_each(p_payments) loop
    if v_key not in ('cash', 'upi', 'card', 'credit', 'bank') then
      raise exception 'Unknown payment method: %', v_key;
    end if;
    if v_val < 0 then raise exception 'Amounts can''t be negative'; end if;
    if v_val > 0 then
      v_clean := v_clean || jsonb_build_object(v_key, round(v_val, 2));
      v_sum := v_sum + round(v_val, 2);
    end if;
  end loop;
  v_credit := coalesce((v_clean->>'credit')::numeric, 0);
  if v_credit > 0 and p_customer_id is null then
    raise exception 'Udhaar (credit) part needs a customer. Pick or add the customer first.';
  end if;

  v_sale := public.create_sale(p_items, p_customer_id, 'cash', p_location_id);

  if abs(v_sum - v_sale.total_amount) > 0.009 and abs(v_sum - v_sale.total_amount) <= 0.05 then
    select key into v_key from jsonb_each_text(v_clean) order by value::numeric desc limit 1;
    v_clean := jsonb_set(v_clean, array[v_key], to_jsonb(round((v_clean->>v_key)::numeric + v_sale.total_amount - v_sum, 2)));
    v_credit := coalesce((v_clean->>'credit')::numeric, 0);
    v_sum := v_sale.total_amount;
  end if;
  if abs(v_sum - v_sale.total_amount) > 0.009 then
    raise exception 'Payments add up to % but the bill is %', v_sum, v_sale.total_amount;
  end if;

  update public.sales
  set payment_method = 'split', payment_split = v_clean, credit_amount = nullif(v_credit, 0)
  where id = v_sale.id
  returning * into v_sale;
  return v_sale;
end;
$$;
revoke all on function public.create_sale_split(jsonb, jsonb, uuid, uuid) from public, anon;
grant execute on function public.create_sale_split(jsonb, jsonb, uuid, uuid) to authenticated;

-- ---------- Best sellers for quick-pick (follows the viewer's access)
create or replace function public.top_sellers(p_location_id uuid default null, p_days integer default 30, p_limit integer default 8)
returns table (product_id uuid, quantity numeric)
language sql stable security invoker set search_path = public as $$
  select si.product_id, sum(si.quantity)::numeric
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))
    and (p_location_id is null or s.location_id = p_location_id)
    and coalesce(s.status, 'completed') <> 'cancelled'
    and si.product_id is not null
  group by si.product_id
  order by 2 desc
  limit least(greatest(coalesce(p_limit, 8), 1), 24)
$$;
grant execute on function public.top_sellers(uuid, integer, integer) to authenticated;

-- ---------- Audit the new tables too
do $$
declare t text;
begin
  if to_regprocedure('public.audit_row()') is not null then
    foreach t in array array['coupons', 'discount_approvals', 'coupon_redemptions'] loop
      execute format('drop trigger if exists trg_audit on public.%I', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';
