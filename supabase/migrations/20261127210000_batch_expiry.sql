-- =====================================================================
-- DailyKart: batch numbers and expiry dates
--
-- A batch is recorded when stock comes in (purchase entry or Stock page).
-- Sales don't need to pick a batch: the app assumes the oldest stock is
-- sold first and works out what is probably left of each batch.
--
-- Safe to run more than once. Only ADDS things.
-- =====================================================================

create table if not exists public.product_batches (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  batch_no text,
  expiry_date date,
  quantity integer not null check (quantity > 0),
  purchase_id uuid references public.purchases(id) on delete set null,
  cleared_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (batch_no is not null or expiry_date is not null)
);
create index if not exists idx_product_batches_product on public.product_batches(product_id, created_at desc);
create index if not exists idx_product_batches_expiry on public.product_batches(location_id, expiry_date) where cleared_at is null;

alter table public.product_batches enable row level security;

-- Everyone in the store can see expiry dates (cashiers check them at the counter)
drop policy if exists "store read product_batches" on public.product_batches;
create policy "store read product_batches" on public.product_batches for select to authenticated
  using (get_user_role(auth.uid()) = 'admin' or location_id = get_user_location(auth.uid()));

drop policy if exists "manager insert product_batches" on public.product_batches;
create policy "manager insert product_batches" on public.product_batches for insert to authenticated
  with check (get_user_role(auth.uid()) = 'admin'
              or (get_user_role(auth.uid()) = 'manager' and location_id = get_user_location(auth.uid())));

drop policy if exists "manager update product_batches" on public.product_batches;
create policy "manager update product_batches" on public.product_batches for update to authenticated
  using (get_user_role(auth.uid()) = 'admin'
         or (get_user_role(auth.uid()) = 'manager' and location_id = get_user_location(auth.uid())))
  with check (get_user_role(auth.uid()) = 'admin'
              or (get_user_role(auth.uid()) = 'manager' and location_id = get_user_location(auth.uid())));

grant select, insert, update on public.product_batches to authenticated;

-- The batch always belongs to the product's store
create or replace function public.set_batch_location()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select p.location_id into new.location_id from public.products p where p.id = new.product_id;
  if new.location_id is null then raise exception 'Product not found'; end if;
  return new;
end;
$$;
drop trigger if exists trg_set_batch_location on public.product_batches;
create trigger trg_set_batch_location before insert on public.product_batches
  for each row execute function public.set_batch_location();

notify pgrst, 'reload schema';
