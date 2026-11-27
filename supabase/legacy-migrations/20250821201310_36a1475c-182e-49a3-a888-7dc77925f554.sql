-- SECURITY FIX: Address linter warnings

-- Fix search_path for existing functions
ALTER FUNCTION public.log_security_event(text, uuid, jsonb) SET search_path = public;
ALTER FUNCTION public.audit_role_changes() SET search_path = public;

-- Fix search_path for all existing functions that might be missing it
ALTER FUNCTION public.get_user_role(uuid) SET search_path = public;
ALTER FUNCTION public.get_user_location(uuid) SET search_path = public;
ALTER FUNCTION public.is_email_invited(text) SET search_path = public;
ALTER FUNCTION public.mark_invitation_used(text) SET search_path = public;
ALTER FUNCTION public.default_location() SET search_path = public;
ALTER FUNCTION public.handle_new_user() SET search_path = public;