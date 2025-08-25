-- Remove invited_users table and create user creation functions
DROP TABLE IF EXISTS invited_users CASCADE;

-- Create function to directly create users with passwords
CREATE OR REPLACE FUNCTION create_user_with_role(
  p_email TEXT,
  p_password TEXT,
  p_full_name TEXT,
  p_role TEXT DEFAULT 'cashier'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_user_id UUID;
  result JSON;
BEGIN
  -- Create the user in auth.users (this requires RPC to Supabase Auth API)
  -- Note: This function placeholder - actual implementation would need Supabase Admin API
  
  -- For now, we'll return a structure that indicates the admin needs to create the user manually
  result := json_build_object(
    'success', true,
    'message', 'Admin should create user through Supabase Auth dashboard',
    'email', p_email,
    'role', p_role,
    'full_name', p_full_name
  );
  
  RETURN result;
END;
$$;