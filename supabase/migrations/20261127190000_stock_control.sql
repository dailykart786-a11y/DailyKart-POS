-- =====================================================================
-- DailyKart: stock control (stock adjustments with a reason)
--
-- Safe to run more than once. Only ADDS things. The app keeps working
-- without it: the reorder list works anyway, and the "Adjust stock" part
-- asks for this update.
-- =====================================================================

create table if not exists public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  quantity_change integer not null,
  stock_before integer not null,
  stock_after integer not null,
  reason text not null check (reason in ('count', 'damaged', 'expired', 'lost', 'own_use', 'found', 'opening', 'other')),
  note text,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_adjustments_location on public.stock_adjustments(location_id, created_at desc);
create index if not exists idx_stock_adjustments_product on public.stock_adjustments(product_id, created_at desc);

alter table public.stock_adjustments enable row level security;
-- Read only. Rows are written by adjust_stock() below, never directly.
drop policy if exists "store read stock_adjustments" on public.stock_adjustments;
create policy "store read stock_adjustments" on public.stock_adjustments for select to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or (get_user_role(auth.uid()) = 'manager' and location_id = get_user_location(auth.uid())));
grant select on public.stock_adjustments to authenticated;

-- ---------------------------------------------------------------------
-- adjust_stock: change one product's stock and record why, in one go.
--   p_mode 'set'    -> p_quantity is the counted stock (stock count)
--   p_mode 'change' -> p_quantity is added (negative removes)
-- Manager (own store) or admin only. Locks the product row so a sale
-- happening at the same moment is not lost.
-- ---------------------------------------------------------------------
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_quantity integer,
  p_reason text,
  p_mode text default 'change',
  p_note text default null
)
returns public.stock_adjustments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_prod public.products;
  v_before integer;
  v_after integer;
  v_row public.stock_adjustments;
begin
  if v_user is null then raise exception 'Please sign in again'; end if;
  v_role := public.get_user_role(v_user);
  if v_role not in ('admin', 'manager') then
    raise exception 'Only a manager or admin can adjust stock';
  end if;
  if p_quantity is null then raise exception 'Enter a quantity'; end if;
  if coalesce(p_mode, '') not in ('set', 'change') then raise exception 'Unknown mode: %', p_mode; end if;
  if coalesce(p_reason, '') not in ('count', 'damaged', 'expired', 'lost', 'own_use', 'found', 'opening', 'other') then
    raise exception 'Pick a reason';
  end if;

  select * into v_prod from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;
  if v_role <> 'admin' and v_prod.location_id <> public.get_user_location(v_user) then
    raise exception '% belongs to another store', v_prod.name;
  end if;

  v_before := coalesce(v_prod.stock_quantity, 0);
  v_after := case when p_mode = 'set' then p_quantity else v_before + p_quantity end;
  if v_after < 0 then
    raise exception 'Stock for % can''t go below 0 (now %)', v_prod.name, v_before;
  end if;
  if v_after = v_before then
    raise exception 'Stock for % is already %', v_prod.name, v_before;
  end if;

  update public.products set stock_quantity = v_after, updated_at = now() where id = v_prod.id;

  insert into public.stock_adjustments (product_id, location_id, quantity_change, stock_before, stock_after,
                                        reason, note, created_by)
  values (v_prod.id, v_prod.location_id, v_after - v_before, v_before, v_after,
          p_reason, nullif(trim(coalesce(p_note, '')), ''), v_user)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.adjust_stock(uuid, integer, text, text, text) from public, anon;
grant execute on function public.adjust_stock(uuid, integer, text, text, text) to authenticated;

notify pgrst, 'reload schema';
