-- SECURITY FIX: Address Critical Privilege Escalation Vulnerability
-- Phase 1: Fix user_roles table security

-- Drop dangerous policies on user_roles table
DROP POLICY IF EXISTS "Users can view all user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view user roles" ON public.user_roles; 
DROP POLICY IF EXISTS "Authenticated users can manage user roles" ON public.user_roles;

-- Create secure policies for user_roles table
-- Only admins can manage user roles
CREATE POLICY "Admins can manage user roles"
ON public.user_roles
FOR ALL
USING (get_user_role(auth.uid()) = 'admin')
WITH CHECK (get_user_role(auth.uid()) = 'admin');

-- Users can only view their own role
CREATE POLICY "Users can view own role"
ON public.user_roles
FOR SELECT
USING (user_id = auth.uid());

-- SECURITY FIX: Secure profiles table access
-- Drop overly permissive policy
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

-- Create location-based access control for profiles
CREATE POLICY "Location scoped select on profiles"
ON public.profiles
FOR SELECT
USING (
  get_user_role(auth.uid()) = 'admin' 
  OR 
  user_id = auth.uid()
  OR
  EXISTS (
    SELECT 1 FROM public.user_location_assignments ula1, public.user_location_assignments ula2
    WHERE ula1.user_id = auth.uid() 
    AND ula2.user_id = profiles.user_id 
    AND ula1.location_id = ula2.location_id
  )
);

-- SECURITY FIX: Remove plaintext password storage
-- Remove temp_password column from invited_users table
ALTER TABLE public.invited_users DROP COLUMN IF EXISTS temp_password;

-- Add invitation token for secure invitations
ALTER TABLE public.invited_users ADD COLUMN IF NOT EXISTS invitation_token uuid DEFAULT gen_random_uuid();
ALTER TABLE public.invited_users ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone DEFAULT (now() + interval '7 days');

-- Create index on invitation token for performance
CREATE INDEX IF NOT EXISTS idx_invited_users_token ON public.invited_users(invitation_token);

-- SECURITY FIX: Add security audit logging
-- Create audit log table for security events
CREATE TABLE IF NOT EXISTS public.security_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  user_id uuid REFERENCES auth.users(id),
  target_user_id uuid,
  details jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS on audit log
ALTER TABLE public.security_audit_log ENABLE ROW LEVEL SECURITY;

-- Only admins can view audit logs
CREATE POLICY "Admins can view audit logs"
ON public.security_audit_log
FOR SELECT
USING (get_user_role(auth.uid()) = 'admin');

-- System can insert audit logs
CREATE POLICY "System can insert audit logs"
ON public.security_audit_log
FOR INSERT
WITH CHECK (true);

-- Create function to log security events
CREATE OR REPLACE FUNCTION public.log_security_event(
  event_type text,
  target_user_id uuid DEFAULT NULL,
  details jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.security_audit_log (
    event_type,
    user_id,
    target_user_id,
    details
  ) VALUES (
    event_type,
    auth.uid(),
    target_user_id,
    details
  );
END;
$$;

-- Create trigger to log role changes
CREATE OR REPLACE FUNCTION public.audit_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM log_security_event('role_assigned', NEW.user_id, jsonb_build_object('new_role', NEW.role));
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM log_security_event('role_changed', NEW.user_id, jsonb_build_object('old_role', OLD.role, 'new_role', NEW.role));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM log_security_event('role_removed', OLD.user_id, jsonb_build_object('removed_role', OLD.role));
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Create trigger for role audit logging
DROP TRIGGER IF EXISTS audit_user_role_changes ON public.user_roles;
CREATE TRIGGER audit_user_role_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_role_changes();