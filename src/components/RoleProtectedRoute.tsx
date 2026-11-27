import { useUserRole } from '@/hooks/useUserRole';
import { ErrorState } from '@/components/feedback/ErrorState';
import { PageSkeleton } from '@/components/feedback/Skeletons';

interface RoleProtectedRouteProps {
  children: React.ReactNode;
  requiredPermission: string;
}

/** Shows the page only to roles allowed to see it. The database checks again on every read and write. */
export function RoleProtectedRoute({ children, requiredPermission }: RoleProtectedRouteProps) {
  const { hasPermission, loading } = useUserRole();

  if (loading) return <PageSkeleton />;

  if (!hasPermission(requiredPermission)) {
    return <ErrorState code={403} />;
  }

  return <>{children}</>;
}
