-- =====================================================================
-- DailyKart: GST e-invoice (IRN) for bills to registered businesses
--   * e_invoices: the IRN, acknowledgement number and date, and the
--     signed QR code the government portal gives back for a bill, so
--     the bill can be printed as an e-invoice. Bills themselves are not
--     changed.
--   * save_e_invoice / cancel_e_invoice: for people with the Reports or
--     Accounts permission in that bill's store.
-- Only adds. Safe to run more than once.
-- =====================================================================

create table if not exists public.e_invoices (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  irn text not null,
  ack_no text,
  ack_date timestamptz,
  signed_qr text,
  status text not null default 'active',
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint e_invoices_status_ok check (status in ('active', 'cancelled')),
  constraint e_invoices_irn_ok check (irn ~ '^[0-9a-f]{64}$')
);
create unique index if not exists uq_e_invoices_active_sale on public.e_invoices(sale_id) where status = 'active';
create unique index if not exists uq_e_invoices_irn on public.e_invoices(irn);
create index if not exists idx_e_invoices_location on public.e_invoices(location_id, created_at);

alter table public.e_invoices enable row level security;
drop policy if exists "read e_invoices" on public.e_invoices;
create policy "read e_invoices" on public.e_invoices for select to authenticated
  using (public.get_user_role(auth.uid()) = 'admin' or location_id = public.get_user_location(auth.uid()));
grant select on public.e_invoices to authenticated;
do $$ begin
  if to_regprocedure('public.mfa_ok()') is not null then
    execute 'drop policy if exists "two-step login" on public.e_invoices';
    execute 'create policy "two-step login" on public.e_invoices as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))';
  end if;
end $$;

create or replace function public.save_e_invoice(
  p_sale_id uuid, p_irn text, p_ack_no text default null, p_ack_date timestamptz default null, p_signed_qr text default null)
returns public.e_invoices language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_sale record;
  v_irn text := lower(trim(coalesce(p_irn, '')));
  v_row public.e_invoices;
begin
  if v_user is null then raise exception 'Please sign in again'; end if;
  if not (public.has_perm('reports') or public.has_perm('accounts')) then
    raise exception 'Your role doesn''t allow e-invoices';
  end if;
  select s.id, s.location_id, s.invoice_number, coalesce(s.status, 'completed') as status, c.gstin
    into v_sale from public.sales s left join public.customers c on c.id = s.customer_id where s.id = p_sale_id;
  if not found then raise exception 'Bill not found'; end if;
  if public.get_user_role(v_user) <> 'admin' and v_sale.location_id <> public.get_user_location(v_user) then
    raise exception 'This bill belongs to another store';
  end if;
  if v_sale.status = 'cancelled' then raise exception 'Bill % is cancelled', v_sale.invoice_number; end if;
  if coalesce(v_sale.gstin, '') = '' then raise exception 'Bill % has no customer GSTIN', v_sale.invoice_number; end if;
  if v_irn !~ '^[0-9a-f]{64}$' then raise exception 'The IRN should be 64 letters and numbers (0-9, a-f)'; end if;
  if exists (select 1 from public.e_invoices where sale_id = p_sale_id and status = 'active') then
    raise exception 'Bill % already has an IRN. Cancel it first.', v_sale.invoice_number;
  end if;
  if exists (select 1 from public.e_invoices where irn = v_irn) then
    raise exception 'This IRN is already saved on another bill';
  end if;

  insert into public.e_invoices (sale_id, location_id, irn, ack_no, ack_date, signed_qr, created_by)
  values (p_sale_id, v_sale.location_id, v_irn, nullif(trim(coalesce(p_ack_no, '')), ''), p_ack_date,
          nullif(trim(coalesce(p_signed_qr, '')), ''), v_user)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.cancel_e_invoice(p_sale_id uuid, p_reason text)
returns public.e_invoices language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_row public.e_invoices;
begin
  if v_user is null then raise exception 'Please sign in again'; end if;
  if not (public.has_perm('reports') or public.has_perm('accounts')) then
    raise exception 'Your role doesn''t allow e-invoices';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Write why it was cancelled'; end if;
  select * into v_row from public.e_invoices where sale_id = p_sale_id and status = 'active' for update;
  if not found then raise exception 'This bill has no active IRN'; end if;
  if public.get_user_role(v_user) <> 'admin' and v_row.location_id <> public.get_user_location(v_user) then
    raise exception 'This bill belongs to another store';
  end if;
  update public.e_invoices set status = 'cancelled', cancelled_at = now(), cancel_reason = trim(p_reason)
   where id = v_row.id returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.save_e_invoice(uuid, text, text, timestamptz, text) from public;
revoke all on function public.cancel_e_invoice(uuid, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.save_e_invoice(uuid, text, text, timestamptz, text) from anon';
    execute 'revoke all on function public.cancel_e_invoice(uuid, text) from anon';
  end if;
end $$;
grant execute on function public.save_e_invoice(uuid, text, text, timestamptz, text) to authenticated;
grant execute on function public.cancel_e_invoice(uuid, text) to authenticated;

-- record changes in the activity log, like other money records
do $$ begin
  if to_regprocedure('public.audit_row()') is not null then
    execute 'drop trigger if exists trg_audit_e_invoices on public.e_invoices';
    execute 'create trigger trg_audit_e_invoices after insert or update or delete on public.e_invoices for each row execute function public.audit_row()';
  end if;
end $$;

notify pgrst, 'reload schema';
