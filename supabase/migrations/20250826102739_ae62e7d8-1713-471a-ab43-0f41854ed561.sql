-- Strengthen customer data security by ensuring proper location-based access
-- and adding additional constraints to prevent unauthorized access

-- First, let's add a more restrictive policy for customer data access
-- Drop existing policies to replace with more secure ones
DROP POLICY IF EXISTS "Location scoped select on customers" ON public.customers;
DROP POLICY IF EXISTS "Location scoped insert on customers" ON public.customers;
DROP POLICY IF EXISTS "Location scoped update on customers" ON public.customers;
DROP POLICY IF EXISTS "Location scoped delete on customers" ON public.customers;

-- Create enhanced security policies for customers table
-- Only allow access to customer data for users with proper role permissions and location assignments

-- SELECT policy: Only allow reading customer data if user has proper permission and location access
CREATE POLICY "Secure customer data access" 
ON public.customers 
FOR SELECT 
USING (
  -- Admin users can access all customer data
  (get_user_role(auth.uid()) = 'admin') 
  OR 
  -- Managers and cashiers can only access customers from their assigned location
  (
    get_user_role(auth.uid()) IN ('manager', 'cashier') 
    AND location_id = get_user_location(auth.uid())
    AND get_user_location(auth.uid()) IS NOT NULL  -- Ensure user has a location assignment
  )
);

-- INSERT policy: Only allow creating customers with proper location validation
CREATE POLICY "Secure customer data creation" 
ON public.customers 
FOR INSERT 
WITH CHECK (
  -- Admin users can create customers for any location
  (get_user_role(auth.uid()) = 'admin') 
  OR 
  -- Managers and cashiers can only create customers for their assigned location
  (
    get_user_role(auth.uid()) IN ('manager', 'cashier') 
    AND location_id = get_user_location(auth.uid())
    AND get_user_location(auth.uid()) IS NOT NULL  -- Ensure user has a location assignment
  )
);

-- UPDATE policy: Only allow updating customers with proper location validation
CREATE POLICY "Secure customer data modification" 
ON public.customers 
FOR UPDATE 
USING (
  -- Admin users can update all customer data
  (get_user_role(auth.uid()) = 'admin') 
  OR 
  -- Managers and cashiers can only update customers from their assigned location
  (
    get_user_role(auth.uid()) IN ('manager', 'cashier') 
    AND location_id = get_user_location(auth.uid())
    AND get_user_location(auth.uid()) IS NOT NULL
  )
)
WITH CHECK (
  -- Admin users can update customers for any location
  (get_user_role(auth.uid()) = 'admin') 
  OR 
  -- Managers and cashiers can only update customers for their assigned location
  (
    get_user_role(auth.uid()) IN ('manager', 'cashier') 
    AND location_id = get_user_location(auth.uid())
    AND get_user_location(auth.uid()) IS NOT NULL
  )
);

-- DELETE policy: Only admins and managers can delete customer data
CREATE POLICY "Secure customer data deletion" 
ON public.customers 
FOR DELETE 
USING (
  -- Only admin users can delete customer data
  (get_user_role(auth.uid()) = 'admin') 
  OR 
  -- Managers can only delete customers from their assigned location
  (
    get_user_role(auth.uid()) = 'manager' 
    AND location_id = get_user_location(auth.uid())
    AND get_user_location(auth.uid()) IS NOT NULL
  )
);

-- Add additional security function to log customer data access
CREATE OR REPLACE FUNCTION public.log_customer_access(
  customer_id UUID,
  action_type TEXT
) RETURNS VOID AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically log customer data access
CREATE OR REPLACE FUNCTION public.audit_customer_access()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create triggers for audit logging
DROP TRIGGER IF EXISTS audit_customer_changes ON public.customers;
CREATE TRIGGER audit_customer_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION audit_customer_access();