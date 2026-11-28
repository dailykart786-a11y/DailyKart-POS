-- Harden functions by setting an explicit search_path

-- get_user_role
create or replace function public.get_user_role(user_uuid uuid)
 returns text
 language sql
 stable
 security definer
 set search_path = public
as $function$
  SELECT COALESCE(
    (SELECT role FROM public.user_roles WHERE user_id = user_uuid),
    'cashier'
  );
$function$;

-- is_email_invited
create or replace function public.is_email_invited(email_address text)
 returns boolean
 language sql
 stable
 set search_path = public
as $function$
  SELECT EXISTS (
    SELECT 1 FROM public.invited_users 
    WHERE email = email_address AND used_at IS NULL
  );
$function$;

-- mark_invitation_used
create or replace function public.mark_invitation_used(email_address text)
 returns void
 language sql
 set search_path = public
as $function$
  UPDATE public.invited_users 
  SET used_at = now() 
  WHERE email = email_address AND used_at IS NULL;
$function$;

-- handle_new_user
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path = public
as $function$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$function$;

-- default_location
create or replace function public.default_location()
returns uuid
language sql
stable
set search_path = public
as $$
  select id from public.locations where name = 'Default Store' limit 1
$$;

-- get_user_location
create or replace function public.get_user_location(user_uuid uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ula.location_id
  from public.user_location_assignments ula
  where ula.user_id = user_uuid
  limit 1
$$;
