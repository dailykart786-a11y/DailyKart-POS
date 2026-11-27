-- Fix security warnings by adding proper search_path to functions

-- Update log_customer_access function with proper search_path
CREATE OR REPLACE FUNCTION public.log_customer_access(
  customer_id UUID,
  action_type TEXT
) RETURNS VOID 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Log customer data access for audit purposes
  INSERT INTO public.security_audit_log (
    event_type,
    user_id,
    target_user_id,
    details
  ) VALUES (
    'customer_data_access',
    auth.uid(),
    NULL,
    jsonb_build_object(
      'customer_id', customer_id,
      'action', action_type,
      'timestamp', now()
    )
  );
END;
$$;

-- Update audit_customer_access function with proper search_path
CREATE OR REPLACE FUNCTION public.audit_customer_access()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF TG_OP = 'SELECT' THEN
    -- Note: SELECT triggers are not supported in PostgreSQL
    -- This would need to be implemented in application code
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM log_customer_access(NEW.id, 'CREATE');
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM log_customer_access(NEW.id, 'UPDATE');
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM log_customer_access(OLD.id, 'DELETE');
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;