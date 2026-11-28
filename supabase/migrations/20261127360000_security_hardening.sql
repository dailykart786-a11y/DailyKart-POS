-- =====================================================================
-- DailyKart: security hardening
--   * two-step login is enforced by the database: once a person turns on
--     an authenticator app, their data can only be read or changed after
--     they type its code (a stolen password alone is not enough)
--   * tighter write rules: only people whose role allows it can change
--     products, suppliers, expenses or record khata payments; bills and
--     bill lines can only be made through billing (no direct edits)
--   * functions can no longer be called by signed-out visitors
-- Safe to run more than once.
-- =====================================================================

-- ---------- Two-step login (Supabase Auth MFA)
-- true when this session passed the second step, or the person has no
-- authenticator turned on
create or replace function public.mfa_ok()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_aal text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', '');
  v_has boolean := false;
begin
  if auth.uid() is null or v_aal = 'aal2' then return true; end if;
  if to_regclass('auth.mfa_factors') is null then return true; end if;
  execute 'select exists (select 1 from auth.mfa_factors where user_id = $1 and status = ''verified'')' into v_has using auth.uid();
  return not v_has;
end;
$$;
grant execute on function public.mfa_ok() to authenticated;

-- one "restrictive" rule on every table, added on top of the existing ones
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
             and c.relname not in ('schema_once')
  loop
    execute format('drop policy if exists "two-step login" on public.%I', r.relname);
    execute format('create policy "two-step login" on public.%I as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))', r.relname);
  end loop;
end $$;

-- Same check before every API call, so functions (billing, payments...) are
-- covered too. If this setting can't be changed here, the table rules above
-- still apply.
create or replace function public.check_request()
returns void language plpgsql stable set search_path = public as $$
declare v_ok boolean := true;
begin
  begin
    v_ok := public.mfa_ok();
  exception when others then
    v_ok := true;  -- never block the app because of this check itself
  end;
  if not v_ok then
    raise exception 'Enter the code from your authenticator app to continue'
      using errcode = '42501', hint = 'two_step_login_needed';
  end if;
end;
$$;
grant execute on function public.check_request() to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.check_request() to anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    begin
      execute 'alter role authenticator set pgrst.db_pre_request to ''public.check_request''';
      notify pgrst, 'reload config';
    exception when others then
      raise notice 'Could not set the two-step check for API calls (%). Table rules still apply.', sqlerrm;
    end;
  end if;
end $$;

-- ---------- Tighter write rules
-- products: Products permission (owner everywhere)
drop policy if exists "store insert products" on public.products;
create policy "store insert products" on public.products for insert to authenticated
  with check (public.get_user_role(auth.uid()) = 'admin'
              or (public.has_perm('products') and location_id = public.get_user_location(auth.uid())));
drop policy if exists "store update products" on public.products;
create policy "store update products" on public.products for update to authenticated
  using (public.get_user_role(auth.uid()) = 'admin'
         or (public.has_perm('products') and location_id = public.get_user_location(auth.uid())))
  with check (public.get_user_role(auth.uid()) = 'admin'
              or (public.has_perm('products') and location_id = public.get_user_location(auth.uid())));

-- bills and bill lines: only through the billing functions (owner can still repair)
drop policy if exists "store insert sales" on public.sales;
create policy "store insert sales" on public.sales for insert to authenticated
  with check (public.get_user_role(auth.uid()) = 'admin');
drop policy if exists "store update sales" on public.sales;
create policy "store update sales" on public.sales for update to authenticated
  using (public.get_user_role(auth.uid()) = 'admin') with check (public.get_user_role(auth.uid()) = 'admin');
drop policy if exists "store insert sale_items" on public.sale_items;
create policy "store insert sale_items" on public.sale_items for insert to authenticated
  with check (public.get_user_role(auth.uid()) = 'admin');
drop policy if exists "store update sale_items" on public.sale_items;
create policy "store update sale_items" on public.sale_items for update to authenticated
  using (public.get_user_role(auth.uid()) = 'admin');

-- suppliers: Purchases or Accounts permission
drop policy if exists "store insert suppliers" on public.suppliers;
create policy "store insert suppliers" on public.suppliers for insert to authenticated
  with check (public.get_user_role(auth.uid()) = 'admin'
              or ((public.has_perm('purchases') or public.has_perm('accounts')) and location_id = public.get_user_location(auth.uid())));
drop policy if exists "store update suppliers" on public.suppliers;
create policy "store update suppliers" on public.suppliers for update to authenticated
  using (public.get_user_role(auth.uid()) = 'admin'
         or ((public.has_perm('purchases') or public.has_perm('accounts')) and location_id = public.get_user_location(auth.uid())))
  with check (public.get_user_role(auth.uid()) = 'admin'
              or ((public.has_perm('purchases') or public.has_perm('accounts')) and location_id = public.get_user_location(auth.uid())));

-- khata payments: Khata permission
drop policy if exists "store insert customer_payments" on public.customer_payments;
create policy "store insert customer_payments" on public.customer_payments for insert to authenticated
  with check (public.get_user_role(auth.uid()) = 'admin'
              or (public.has_perm('khata') and location_id = public.get_user_location(auth.uid())));

-- expenses: Expenses permission (salary and advances go through their own functions)
drop policy if exists "store insert expenses" on public.expenses;
create policy "store insert expenses" on public.expenses for insert to authenticated
  with check (public.get_user_role(auth.uid()) = 'admin'
              or (public.has_perm('expenses') and location_id = public.get_user_location(auth.uid())));
drop policy if exists "store update expenses" on public.expenses;
create policy "store update expenses" on public.expenses for update to authenticated
  using (public.get_user_role(auth.uid()) = 'admin'
         or (public.has_perm('expenses') and location_id = public.get_user_location(auth.uid())))
  with check (public.get_user_role(auth.uid()) = 'admin'
              or (public.has_perm('expenses') and location_id = public.get_user_location(auth.uid())));

-- ---------- Functions: signed-in people only
-- Keeps exactly the signed-in access each function has today; removes the
-- signed-out (anon / everyone) access. Run again after adding functions.
create or replace function public.secure_function_grants()
returns void language plpgsql set search_path = public as $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, has_function_privilege('authenticated', p.oid, 'execute') as signed_in
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')  -- not extension functions
      and p.proname <> 'check_request'  -- runs before every API call, also for signed-out visitors
  loop
    if r.signed_in then execute format('grant execute on function %s to authenticated', r.sig); end if;
    execute format('revoke execute on function %s from public', r.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', r.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', r.sig); end if;
  end loop;
end;
$$;

select public.secure_function_grants();
revoke execute on function public.secure_function_grants() from authenticated;
-- internal only: used by the udhaar limit check
revoke execute on function public.customer_due(uuid) from authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.check_request() to anon';
  end if;
end $$;

-- new functions start without signed-out access
alter default privileges revoke execute on functions from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'alter default privileges in schema public revoke execute on functions from anon';
  end if;
end $$;

notify pgrst, 'reload schema';
