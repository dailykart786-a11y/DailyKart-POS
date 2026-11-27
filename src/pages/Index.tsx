import { ClockCard } from "@/components/ClockCard";
import { OwnerSnapshot } from "@/components/OwnerSnapshot";
import { Layout } from "@/components/Layout";
import { RealtimeDashboard } from "@/components/RealtimeDashboard";

const Index = () => {
  return (
    <Layout>
      <ClockCard />
      <OwnerSnapshot />
      <RealtimeDashboard />
    </Layout>
  );
};

export default Index;
