-- Create a table to track invited users
CREATE TABLE public.invited_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'manager', 'cashier')),
  invited_by uuid REFERENCES auth.users(id) NOT NULL,
  invited_at timestamp with time zone DEFAULT now(),
  used_at timestamp with time zone NULL,
  temp_password text NOT NULL
);

-- Enable RLS on invited_users
ALTER TABLE public.invited_users ENABLE ROW LEVEL SECURITY;

-- Create policies for invited_users
CREATE POLICY "Admins can manage invited users" 
ON public.invited_users 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur 
    WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
  )
);

-- Function to check if email is invited
CREATE OR REPLACE FUNCTION public.is_email_invited(email_address text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.invited_users 
    WHERE email = email_address AND used_at IS NULL
  );
$$;

-- Function to mark invitation as used
CREATE OR REPLACE FUNCTION public.mark_invitation_used(email_address text)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.invited_users 
  SET used_at = now() 
  WHERE email = email_address AND used_at IS NULL;
$$;