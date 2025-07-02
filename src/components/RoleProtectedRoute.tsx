import { useUserRole } from '@/hooks/useUserRole';
import { Navigate } from 'react-router-dom';
import { Shield } from 'lucide-react';

interface RoleProtectedRouteProps {
  children: React.ReactNode;
  requiredPermission: string;
}

export function RoleProtectedRoute({ children, requiredPermission }: RoleProtectedRouteProps) {
  const { hasPermission, loading } = useUserRole();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary/30">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!hasPermission(requiredPermission)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary/30">
        <div className="text-center py-8">
          <Shield className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Access Restricted</h2>
          <p className="text-muted-foreground">
            You don't have permission to access this page.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}