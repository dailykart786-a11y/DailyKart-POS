import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { TwoStepGate } from '@/components/TwoStepGate';
import { FullPageLoader } from '@/components/feedback/FullPageLoader';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return <FullPageLoader />;
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return <TwoStepGate userId={user.id}>{children}</TwoStepGate>;
}