-- =====================================================================
-- DailyKart: activity / audit log
-- Who did what, when: bills, returns, payments, purchases, stock,
-- products, customers, expenses, users, settings.
-- Rows are written only by triggers and can't be edited or deleted.
--
-- Safe to run more than once. Only ADDS things.
-- =====================================================================

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  location_id uuid,
  table_name text not null,
  record_id text,
  action text not null check (action in ('insert', 'update', 'delete')),
  changes jsonb,          -- new row (insert), changed fields old/new (update), old row (delete)
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);
create index if not exists idx_audit_logs_time on public.audit_logs(changed_at desc);
create index if not exists idx_audit_logs_location on public.audit_logs(location_id, changed_at desc);
create index if not exists idx_audit_logs_record on public.audit_logs(table_name, record_id);

alter table public.audit_logs enable row level security;
drop policy if exists "read audit_logs" on public.audit_logs;
create policy "read audit_logs" on public.audit_logs for select to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or (get_user_role(auth.uid()) = 'manager' and location_id = get_user_location(auth.uid())));
grant select on public.audit_logs to authenticated;

create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb;
  k text;
begin
  if tg_op = 'UPDATE' then
    v_changes := '{}'::jsonb;
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at') and (v_new -> k) is distinct from (v_old -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('old', v_old -> k, 'new', v_new -> k));
      end if;
    end loop;
    -- a bill being filled in by the transaction that created it: logged once at commit
    if tg_table_name = 'sales' and (v_old ->> 'created_at')::timestamptz = now() then
      return null;
    end if;
    -- stock-only changes are already in the stock ledger
    if v_changes = '{}'::jsonb or (tg_table_name = 'products' and v_changes - 'stock_quantity' = '{}'::jsonb) then
      return null;
    end if;
  else
    v_changes := v_row;
  end if;
  insert into public.audit_logs (location_id, table_name, record_id, action, changes)
  values (
    case when v_row ? 'location_id' then nullif(v_row ->> 'location_id', '')::uuid
         when tg_table_name = 'locations' then (v_row ->> 'id')::uuid end,
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id'),
    lower(tg_op),
    v_changes
  );
  return null;
end;
$$;

-- Bills: logged at commit, with their final totals
create or replace function public.audit_sale_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  select to_jsonb(s) into v from public.sales s where s.id = new.id;
  if v is null then return null; end if;
  insert into public.audit_logs (location_id, table_name, record_id, action, changes, changed_by)
  values ((v ->> 'location_id')::uuid, 'sales', v ->> 'id', 'insert', v, auth.uid());
  return null;
end;
$$;
drop trigger if exists trg_audit_sale_insert on public.sales;
create constraint trigger trg_audit_sale_insert after insert on public.sales
  deferrable initially deferred for each row execute function public.audit_sale_insert();

do $$
declare t text;
begin
  foreach t in array array[
    'sale_returns', 'customer_payments', 'supplier_payments', 'purchases', 'stock_adjustments',
    'products', 'customers', 'suppliers', 'expenses', 'user_roles', 'user_location_assignments', 'locations',
    'offers', 'register_sessions', 'loyalty_redemptions', 'product_batches', 'payment_settings'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_audit on public.%I', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
    end if;
  end loop;
  -- bills: only changes after saving and deletes (the insert is logged at commit above)
  if to_regclass('public.sales') is not null then
    execute 'drop trigger if exists trg_audit on public.sales';
    execute 'create trigger trg_audit after update or delete on public.sales for each row execute function public.audit_row()';
  end if;
end $$;

notify pgrst, 'reload schema';
