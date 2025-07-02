import { Layout } from "@/components/Layout";
import { CustomersManager } from "@/components/CustomersManager";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Search, 
  Plus, 
  Edit, 
  Eye, 
  Users,
  Star,
  Phone,
  Mail
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const customers = [
  { 
    id: 1, 
    name: "Rajesh Kumar", 
    email: "rajesh@example.com",
    phone: "+91 98765-43210",
    totalSpent: 1250.75,
    totalOrders: 15,
    loyaltyPoints: 125,
    tier: "Gold",
    lastVisit: "2024-01-15"
  },
  { 
    id: 2, 
    name: "Priya Sharma", 
    email: "priya@example.com",
    phone: "+91 98765-43211",
    totalSpent: 2890.50,
    totalOrders: 32,
    loyaltyPoints: 289,
    tier: "Platinum",
    lastVisit: "2024-01-14"
  },
  { 
    id: 3, 
    name: "Amit Singh", 
    email: "amit@example.com",
    phone: "+91 98765-43212",
    totalSpent: 765.25,
    totalOrders: 8,
    loyaltyPoints: 76,
    tier: "Silver",
    lastVisit: "2024-01-12"
  },
  { 
    id: 4, 
    name: "Kavya Patel", 
    email: "kavya@example.com",
    phone: "+91 98765-43213",
    totalSpent: 445.80,
    totalOrders: 5,
    loyaltyPoints: 44,
    tier: "Bronze",
    lastVisit: "2024-01-10"
  },
  { 
    id: 5, 
    name: "Arjun Reddy", 
    email: "arjun@example.com",
    phone: "+91 98765-43214",
    totalSpent: 3450.90,
    totalOrders: 45,
    loyaltyPoints: 345,
    tier: "Platinum",
    lastVisit: "2024-01-16"
  },
];

export default function Customers() {
  return (
    <Layout>
      <CustomersManager />
    </Layout>
  );
}