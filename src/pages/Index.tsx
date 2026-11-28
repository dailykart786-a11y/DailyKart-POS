import { useCallback, useState } from "react";
import { ClockCard } from "@/components/ClockCard";
import { OwnerSnapshot } from "@/components/OwnerSnapshot";
import { Layout } from "@/components/Layout";
import { RealtimeDashboard } from "@/components/RealtimeDashboard";
import { BusinessDashboard } from "@/components/dashboard/BusinessDashboard";

const Index = () => {
  // Until the dashboard database update is run, keep showing the previous dashboard
  const [legacy, setLegacy] = useState(false);
  const onMissing = useCallback(() => setLegacy(true), []);

  return (
    <Layout>
      <ClockCard />
      {legacy ? (
        <>
          <p className="mb-4 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            The new dashboard needs a small database update (dashboard-metrics.sql). Until it's run, the previous dashboard is shown.
          </p>
          <OwnerSnapshot />
          <RealtimeDashboard />
        </>
      ) : (
        <BusinessDashboard onMissing={onMissing} />
      )}
    </Layout>
  );
};

export default Index;
