import { Layout } from "@/components/Layout";
import { Sales } from "@/components/Sales";
import { AdminSalesView } from "@/components/AdminSalesView";
import { useUserRole } from "@/hooks/useUserRole";

export default function SalesPage() {
  const { role } = useUserRole();

  return (
    <Layout>
      {role === 'admin' ? <AdminSalesView /> : <Sales />}
    </Layout>
  );
}