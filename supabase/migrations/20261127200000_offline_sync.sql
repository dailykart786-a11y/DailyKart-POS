-- =====================================================================
-- DailyKart: offline billing sync
--
-- When the internet is down, the till keeps billing and saves the bills
-- on the device. When the internet is back, each bill is sent here.
-- Every offline bill carries its own id (client_ref), so a bill can be
-- sent twice without being saved twice.
--
-- Safe to run more than once. Only ADDS things.
-- =====================================================================

alter table public.sales add column if not exists client_ref uuid;
alter table public.sales add column if not exists offline_sold_at timestamptz;
create unique index if not exists idx_sales_client_ref on public.sales(client_ref) where client_ref is not null;

create or replace function public.sync_offline_sale(
  p_client_ref uuid,
  p_items jsonb,
  p_sold_at timestamptz,
  p_customer_id uuid default null,
  p_payment_method text default 'cash',
  p_payments jsonb default null,
  p_location_id uuid default null,
  p_expected_total numeric default null,
  p_uncertain boolean default false
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_sale public.sales;
  v_sold timestamptz;
begin
  if v_user is null then raise exception 'Please sign in again'; end if;
  if p_client_ref is null then raise exception 'Missing bill id'; end if;

  -- Only one sync of the same bill at a time
  perform pg_advisory_xact_lock(hashtext('offline_sale:' || p_client_ref::text));

  -- Already saved? Return it, don't save it again.
  select * into v_sale from public.sales where client_ref = p_client_ref;
  if found then return v_sale; end if;

  -- Keep the time it was really sold, within reason
  v_sold := least(greatest(coalesce(p_sold_at, now()), now() - interval '30 days'), now());

  -- The till lost the connection while saving: the bill may have reached
  -- us already. Match it to a bill by the same cashier, same amount,
  -- saved within a few minutes, that has no offline id yet.
  if p_uncertain and p_expected_total is not null then
    select * into v_sale from public.sales s
    where s.cashier_id = v_user
      and s.client_ref is null
      and abs(s.total_amount - p_expected_total) <= 1
      and s.created_at between v_sold - interval '2 minutes' and v_sold + interval '10 minutes'
      and (select count(*) from public.sale_items si where si.sale_id = s.id)
          = (select count(distinct e->>'product_id') from jsonb_array_elements(p_items) e)
    order by s.created_at
    limit 1
    for update;
    if found then
      update public.sales set client_ref = p_client_ref where id = v_sale.id returning * into v_sale;
      return v_sale;
    end if;
  end if;

  if p_payments is not null and jsonb_typeof(p_payments) = 'object' and p_payment_method = 'split' then
    v_sale := public.create_sale_split(p_items, p_payments, p_customer_id, p_location_id);
  else
    v_sale := public.create_sale(p_items, p_customer_id, p_payment_method, p_location_id);
  end if;

  update public.sales
  set client_ref = p_client_ref,
      offline_sold_at = v_sold,
      created_at = v_sold
  where id = v_sale.id
  returning * into v_sale;

  return v_sale;
end;
$$;

revoke all on function public.sync_offline_sale(uuid, jsonb, timestamptz, uuid, text, jsonb, uuid, numeric, boolean) from public, anon;
grant execute on function public.sync_offline_sale(uuid, jsonb, timestamptz, uuid, text, jsonb, uuid, numeric, boolean) to authenticated;

notify pgrst, 'reload schema';
