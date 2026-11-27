-- Create payment_settings table for UPI configuration per location
create table if not exists public.payment_settings (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null default public.default_location(),
  upi_vpa text not null,
  payee_name text,
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  constraint payment_settings_location_unique unique (location_id)
);

-- Enable RLS
alter table public.payment_settings enable row level security;

-- Policies
-- Admins can do everything
create policy "Admins manage payment settings"
  on public.payment_settings
  as permissive
  for all
  using (public.get_user_role(auth.uid()) = 'admin')
  with check (public.get_user_role(auth.uid()) = 'admin');

-- Non-admin users can only read their location's settings
create policy "Location scoped select on payment_settings"
  on public.payment_settings
  as permissive
  for select
  using (
    public.get_user_role(auth.uid()) = 'admin' OR location_id = public.get_user_location(auth.uid())
  );