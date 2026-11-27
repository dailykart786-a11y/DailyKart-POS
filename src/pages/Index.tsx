import { ClockCard } from "@/components/ClockCard";
import { Layout } from "@/components/Layout";
import { RealtimeDashboard } from "@/components/RealtimeDashboard";

const Index = () => {
  return (
    <Layout>
      <ClockCard />
      <RealtimeDashboard />
    </Layout>
  );
};

export default Index;
