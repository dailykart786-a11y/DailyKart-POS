import { Layout } from "@/components/Layout";
import { ProductsManager } from "@/components/ProductsManager";
import { ScaleSettingsCard } from "@/components/ScaleSettingsCard";
import { CatalogueSettingsCard } from "@/components/CatalogueSettingsCard";

export default function Products() {
  return (
    <Layout>
      <ProductsManager />
      <ScaleSettingsCard />
      <CatalogueSettingsCard />
    </Layout>
  );
}