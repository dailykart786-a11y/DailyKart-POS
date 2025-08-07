import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

export function useUserRole() {
  const { user } = useAuth();
  const [role, setRole] = useState<string>('cashier');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchUserRole();
    } else {
      setRole('cashier');
      setLoading(false);
    }
  }, [user]);

  const fetchUserRole = async () => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user?.id)
        .maybeSingle();

      if (error) {
        console.error('Error fetching user role:', error);
        setRole('cashier');
      } else {
        setRole(data?.role || 'cashier');
      }
    } catch (error) {
      console.error('Error fetching user role:', error);
      setRole('cashier');
    } finally {
      setLoading(false);
    }
  };

  const hasPermission = (permission: string): boolean => {
    const permissions = {
      cashier: ['sales'],
      manager: ['sales', 'products', 'customers', 'expenses', 'reports'],
      admin: ['sales', 'products', 'customers', 'expenses', 'reports', 'users']
    };

    return permissions[role as keyof typeof permissions]?.includes(permission) || false;
  };

  return { role, loading, hasPermission };
}