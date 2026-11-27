-- =====================================================================
-- DailyKart: online catalogue
--   * a public page per store (/shop/<link name>) listing products with
--     price and "in stock / out of stock". Customers pick items and send
--     the order to the shop on WhatsApp. Off until the owner turns it on.
--   * products.show_online: hide single products from the catalogue.
--   * public_catalogue(link name): the only thing signed-out visitors can
--     read. It never shows cost prices, stock counts or other stores.
-- Only adds. Safe to run more than once.
-- =====================================================================

alter table public.locations add column if not exists catalogue_enabled boolean not null default false;
alter table public.locations add column if not exists catalogue_slug text;
alter table public.locations add column if not exists catalogue_whatsapp text;
alter table public.locations add column if not exists catalogue_note text;
alter table public.locations drop constraint if exists locations_catalogue_slug_ok;
alter table public.locations add constraint locations_catalogue_slug_ok
  check (catalogue_slug is null or catalogue_slug ~ '^[a-z0-9][a-z0-9-]{2,39}$');
create unique index if not exists uq_locations_catalogue_slug on public.locations(catalogue_slug) where catalogue_slug is not null;

alter table public.products add column if not exists show_online boolean not null default true;

create or replace function public.public_catalogue(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'store', jsonb_build_object(
      'name', coalesce(nullif(trim(l.business_name), ''), l.name),
      'address', l.address,
      'phone', l.phone,
      'whatsapp', coalesce(nullif(trim(l.catalogue_whatsapp), ''), l.phone),
      'note', l.catalogue_note),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'category', p.category,
               'price', round(p.price * (1 + coalesce(p.gst_rate, 0) / 100), 2),
               'mrp', p.mrp, 'image_url', p.image_url, 'sold_by', coalesce(p.sold_by, 'piece'),
               'in_stock', coalesce(p.stock_quantity, 0) > 0)
             order by p.category nulls last, p.name)
      from public.products p
      where p.location_id = l.id and coalesce(p.is_active, true) and p.show_online and coalesce(p.price, 0) > 0
    ), '[]'::jsonb))
  from public.locations l
  where l.catalogue_enabled and l.catalogue_slug = lower(trim(p_slug))
$$;
revoke all on function public.public_catalogue(text) from public;
grant execute on function public.public_catalogue(text) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.public_catalogue(text) to anon';
  end if;
end $$;

notify pgrst, 'reload schema';
