import { Layout } from "@/components/Layout";
import { ProductsManager } from "@/components/ProductsManager";
import { ScaleSettingsCard } from "@/components/ScaleSettingsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Search, 
  Plus, 
  Edit, 
  Trash2, 
  Package,
  Filter,
  Upload
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const products = [
  { 
    id: 1, 
    name: "Coca Cola 330ml", 
    price: 2.99, 
    cost: 1.50,
    stock: 150, 
    barcode: "1234567890", 
    category: "Beverages",
    supplier: "Coca Cola Co.",
    status: "active"
  },
  { 
    id: 2, 
    name: "White Bread", 
    price: 1.99, 
    cost: 0.80,
    stock: 80, 
    barcode: "1234567891", 
    category: "Bakery",
    supplier: "Local Bakery",
    status: "active"
  },
  { 
    id: 3, 
    name: "Milk 1L", 
    price: 3.49, 
    cost: 2.10,
    stock: 65, 
    barcode: "1234567892", 
    category: "Dairy",
    supplier: "Dairy Farm Ltd.",
    status: "active"
  },
  { 
    id: 4, 
    name: "Bananas (per kg)", 
    price: 2.79, 
    cost: 1.20,
    stock: 45, 
    barcode: "1234567893", 
    category: "Fruits",
    supplier: "Fresh Fruits Co.",
    status: "low_stock"
  },
  { 
    id: 5, 
    name: "Chocolate Bar", 
    price: 1.49, 
    cost: 0.75,
    stock: 120, 
    barcode: "1234567894", 
    category: "Confectionery",
    supplier: "Sweet Treats Inc.",
    status: "active"
  },
];

export default function Products() {
  return (
    <Layout>
      <ProductsManager />
      <ScaleSettingsCard />
    </Layout>
  );
}