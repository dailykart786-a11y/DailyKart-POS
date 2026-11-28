import { Layout } from "@/components/Layout";
import { PaymentSettings } from "@/components/PaymentSettings";
import { StoreDetailsSettings } from "@/components/StoreDetailsSettings";
import { ErrorState, PageSkeleton } from "@/components/feedback";
import { useUserRole } from "@/hooks/useUserRole";
import { Settings2 } from "lucide-react";

/** Shop details printed on bills and UPI payment details. Moved here from the dashboard; same forms. */
const Settings = () => {
  const { role, loading } = useUserRole();
  if (loading) return <Layout><PageSkeleton /></Layout>;
  if (role !== "admin" && role !== "manager") return <Layout><ErrorState code={403} /></Layout>;
  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Settings2 className="h-6 w-6" /> Shop settings</h1>
          <p className="text-sm text-muted-foreground">Shop details printed on bills, and the UPI ID used for payment QR codes.</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <StoreDetailsSettings />
          {role === "admin" && <PaymentSettings />}
        </div>
      </div>
    </Layout>
  );
};

export default Settings;
