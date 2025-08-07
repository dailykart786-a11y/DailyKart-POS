-- Allow admins to delete any profile
create policy "Admins can delete profiles"
  on public.profiles
  for delete
  to authenticated
  using ( public.get_user_role(auth.uid()) = 'admin' );