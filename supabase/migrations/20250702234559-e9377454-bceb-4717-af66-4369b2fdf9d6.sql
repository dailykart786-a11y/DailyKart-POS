-- First, let's get the admin user ID to preserve it
DO $$
DECLARE
    admin_user_id uuid;
BEGIN
    -- Get the admin user ID
    SELECT id INTO admin_user_id 
    FROM auth.users 
    WHERE email = 'mohdfarrukh1234@gmail.com';
    
    -- If admin user exists, proceed with cleanup
    IF admin_user_id IS NOT NULL THEN
        -- Delete sales records for non-admin users first (to avoid FK constraint)
        DELETE FROM public.sales 
        WHERE cashier_id != admin_user_id;
        
        -- Delete sale_items for deleted sales (they should cascade but let's be safe)
        DELETE FROM public.sale_items 
        WHERE sale_id NOT IN (SELECT id FROM public.sales);
        
        -- Delete profiles for non-admin users
        DELETE FROM public.profiles 
        WHERE user_id != admin_user_id;
        
        -- Delete user roles for non-admin users
        DELETE FROM public.user_roles 
        WHERE user_id != admin_user_id;
        
        -- Delete invited users (cleanup invitation table)
        DELETE FROM public.invited_users 
        WHERE email != 'mohdfarrukh1234@gmail.com';
        
        RAISE NOTICE 'Cleanup completed. Admin user % preserved.', admin_user_id;
    ELSE
        RAISE NOTICE 'Admin user not found. No cleanup performed.';
    END IF;
END $$;