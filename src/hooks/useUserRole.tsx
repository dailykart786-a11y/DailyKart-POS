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

  // Last known role, so a manager keeps their pages when the internet drops
  const cachedRole = () => {
    try { return localStorage.getItem(`dailykart-role-${user?.id}`); } catch { return null; }
  };

  const fetchUserRole = async () => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user?.id)
        .maybeSingle();

      if (error) {
        console.error('Error fetching user role:', error);
        setRole(cachedRole() || 'cashier');
      } else {
        const r = data?.role || 'cashier';
        setRole(r);
        try { localStorage.setItem(`dailykart-role-${user?.id}`, r); } catch { /* private mode */ }
      }
    } catch (error) {
      console.error('Error fetching user role:', error);
      setRole(cachedRole() || 'cashier');
    } finally {
      setLoading(false);
    }
  };

  const hasPermission = (permission: string): boolean => {
    const permissions = {
      cashier: ['sales', 'register', 'khata'],
      manager: ['sales', 'register', 'khata', 'returns', 'purchases', 'products', 'customers', 'expenses', 'reports'],
      admin: ['sales', 'register', 'khata', 'returns', 'purchases', 'products', 'customers', 'expenses', 'reports', 'users']
    };

    return permissions[role as keyof typeof permissions]?.includes(permission) || false;
  };

  return { role, loading, hasPermission };
}