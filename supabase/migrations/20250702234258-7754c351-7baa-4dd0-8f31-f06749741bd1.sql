-- Fix the infinite recursion issue in user_roles policies
DROP POLICY IF EXISTS "Admins can manage user roles" ON public.user_roles;

-- Create a simpler policy that doesn't cause recursion
CREATE POLICY "Users can view user roles" 
ON public.user_roles 
FOR SELECT 
USING (true);

CREATE POLICY "Authenticated users can manage user roles" 
ON public.user_roles 
FOR ALL 
USING (auth.role() = 'authenticated'::text);

-- Update mohdfarrukh1234@gmail.com to admin role
UPDATE public.user_roles 
SET role = 'admin' 
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'mohdfarrukh1234@gmail.com'
);

-- If no role exists, insert it
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'
FROM auth.users 
WHERE email = 'mohdfarrukh1234@gmail.com'
AND id NOT IN (SELECT user_id FROM public.user_roles);