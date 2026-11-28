-- =====================================================================
-- DailyKart: loose and weighed goods
--   * stock can hold parts of a unit (0.750 kg of rice, 1.5 L of oil):
--     products.stock_quantity and min_stock_level become numeric(12,3);
--     stock adjustments too. Whole numbers stay exactly as they are.
--   * products.sold_by: piece (default), weight (kg) or volume (L).
--     Bills with part of a piece are refused for piece products, so
--     nothing changes for them.
--   * products.plu_code + store scale settings, so labels printed by a
--     weighing scale (barcode with the item code and the weight or price
--     inside) can be scanned at billing.
-- Only widens and adds. Safe to run more than once.
-- =====================================================================

do $$ begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'products' and column_name = 'stock_quantity') = 'integer' then
    drop view if exists public.stock_ledger_check;
    -- the stock ledger trigger watches this column: take it off for the change and put it straight back
    drop trigger if exists trg_log_stock_movement on public.products;
    alter table public.products alter column stock_quantity type numeric(12,3);
    alter table public.products alter column min_stock_level type numeric(12,3);
    create trigger trg_log_stock_movement after insert or update of stock_quantity on public.products
      for each row execute function public.log_stock_movement();
  end if;
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'stock_adjustments' and column_name = 'quantity_change') = 'integer' then
    alter table public.stock_adjustments alter column quantity_change type numeric(12,3);
    alter table public.stock_adjustments alter column stock_before type numeric(12,3);
    alter table public.stock_adjustments alter column stock_after type numeric(12,3);
  end if;
end $$;

create or replace view public.stock_ledger_check
with (security_invoker = true) as
select p.id as product_id, p.name, p.location_id, coalesce(p.stock_quantity, 0) as stock_quantity,
       coalesce(sum(m.quantity_change), 0) as ledger_quantity
from public.products p
left join public.stock_movements m on m.product_id = p.id
group by p.id
having coalesce(p.stock_quantity, 0) <> coalesce(sum(m.quantity_change), 0);
grant select on public.stock_ledger_check to authenticated;

alter table public.products add column if not exists sold_by text not null default 'piece';
alter table public.products drop constraint if exists products_sold_by_ok;
alter table public.products add constraint products_sold_by_ok check (sold_by in ('piece', 'weight', 'volume'));
alter table public.products add column if not exists plu_code text;
create unique index if not exists uq_products_plu on public.products(location_id, plu_code) where plu_code is not null;

-- Scale labels: <prefix><item code><weight in grams or price in paise><check digit>, 13 digits
alter table public.locations add column if not exists scale_prefix text;            -- e.g. '21'; empty = scale labels off
alter table public.locations add column if not exists scale_value text not null default 'weight';
alter table public.locations drop constraint if exists locations_scale_value_ok;
alter table public.locations add constraint locations_scale_value_ok check (scale_value in ('weight', 'price'));
alter table public.locations add column if not exists scale_code_digits smallint not null default 5;
alter table public.locations drop constraint if exists locations_scale_digits_ok;
alter table public.locations add constraint locations_scale_digits_ok check (scale_code_digits between 4 and 6);

-- Piece products can't be billed in parts
create or replace function public.check_piece_quantity()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prod record;
begin
  if new.quantity <> trunc(new.quantity) then
    select name, sold_by into v_prod from public.products where id = new.product_id;
    if coalesce(v_prod.sold_by, 'piece') = 'piece' then
      raise exception '% is sold by the piece. Use a whole number.', coalesce(v_prod.name, 'This item');
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_check_piece_quantity on public.sale_items;
create trigger trg_check_piece_quantity before insert on public.sale_items
  for each row execute function public.check_piece_quantity();

-- Stock adjustment with parts of a unit (replaces the whole-number version)
drop function if exists public.adjust_stock(uuid, integer, text, text, text);
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_quantity numeric,
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
  v_before numeric;
  v_after numeric;
  v_row public.stock_adjustments;
begin
  if v_user is null then raise exception 'Please sign in again'; end if;
  v_role := public.get_user_role(v_user);
  if not public.has_perm('stock') then
    raise exception 'Your role doesn''t allow stock changes';
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
  if coalesce(v_prod.sold_by, 'piece') = 'piece' and p_quantity <> trunc(p_quantity) then
    raise exception '% is counted in whole pieces', v_prod.name;
  end if;

  v_before := coalesce(v_prod.stock_quantity, 0);
  v_after := round(case when p_mode = 'set' then p_quantity else v_before + p_quantity end, 3);
  if v_after < 0 then
    raise exception 'Stock for % can''t go below 0 (now %)', v_prod.name, trim_scale(v_before);
  end if;
  if v_after = v_before then
    raise exception 'Stock for % is already %', v_prod.name, trim_scale(v_before);
  end if;

  perform set_config('dailykart.stock_src', 'adjustment|' || p_reason || '|' || v_prod.id::text, true);
  update public.products set stock_quantity = v_after, updated_at = now() where id = v_prod.id;

  insert into public.stock_adjustments (product_id, location_id, quantity_change, stock_before, stock_after,
                                        reason, note, created_by)
  values (v_prod.id, v_prod.location_id, v_after - v_before, v_before, v_after,
          p_reason, nullif(trim(coalesce(p_note, '')), ''), v_user)
  returning * into v_row;

  return v_row;
end;
$$;
revoke all on function public.adjust_stock(uuid, numeric, text, text, text) from public, anon;
grant execute on function public.adjust_stock(uuid, numeric, text, text, text) to authenticated;

notify pgrst, 'reload schema';
