import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_PERMISSIONS } from '@/lib/roles';

export function useUserRole() {
  const { user } = useAuth();
  const [role, setRole] = useState<string>('cashier');
  const [perms, setPerms] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchUserRole();
    } else {
      setRole('cashier');
      setPerms(null);
      setLoading(false);
    }
  }, [user]);

  // Last known role, so a manager keeps their pages when the internet drops
  const cachedRole = () => {
    try { return localStorage.getItem(`dailykart-role-${user?.id}`); } catch { return null; }
  };

  const fetchUserRole = async () => {
    let r = 'cashier';
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user?.id)
        .maybeSingle();

      if (error) {
        console.error('Error fetching user role:', error);
        r = cachedRole() || 'cashier';
      } else {
        r = data?.role || 'cashier';
        try { localStorage.setItem(`dailykart-role-${user?.id}`, r); } catch { /* private mode */ }
      }
    } catch (error) {
      console.error('Error fetching user role:', error);
      r = cachedRole() || 'cashier';
    }
    setRole(r);

    // What the owner allowed this role (falls back to the defaults)
    if (r !== 'admin') {
      try {
        const { data, error } = await supabase.from('role_permissions' as any).select('permission').eq('role', r);
        if (!error && data && (data as any[]).length > 0) setPerms((data as any[]).map(x => x.permission));
        else setPerms(null);
      } catch {
        setPerms(null);
      }
    }
    setLoading(false);
  };

  const hasPermission = (permission: string): boolean => {
    if (role === 'admin') return true;
    if (permission === 'users') return false; // only the owner manages users
    const list = perms || DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.cashier;
    return list.includes(permission);
  };

  return { role, loading, hasPermission };
}
