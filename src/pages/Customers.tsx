import { useState } from "react";
import { Layout } from "@/components/Layout";
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
    name: "John Doe", 
    email: "john@example.com",
    phone: "+1 234-567-8901",
    totalSpent: 1250.75,
    totalOrders: 15,
    loyaltyPoints: 125,
    tier: "Gold",
    lastVisit: "2024-01-15"
  },
  { 
    id: 2, 
    name: "Sarah Smith", 
    email: "sarah@example.com",
    phone: "+1 234-567-8902",
    totalSpent: 2890.50,
    totalOrders: 32,
    loyaltyPoints: 289,
    tier: "Platinum",
    lastVisit: "2024-01-14"
  },
  { 
    id: 3, 
    name: "Mike Johnson", 
    email: "mike@example.com",
    phone: "+1 234-567-8903",
    totalSpent: 765.25,
    totalOrders: 8,
    loyaltyPoints: 76,
    tier: "Silver",
    lastVisit: "2024-01-12"
  },
  { 
    id: 4, 
    name: "Emily Davis", 
    email: "emily@example.com",
    phone: "+1 234-567-8904",
    totalSpent: 445.80,
    totalOrders: 5,
    loyaltyPoints: 44,
    tier: "Bronze",
    lastVisit: "2024-01-10"
  },
  { 
    id: 5, 
    name: "Robert Wilson", 
    email: "robert@example.com",
    phone: "+1 234-567-8905",
    totalSpent: 3450.90,
    totalOrders: 45,
    loyaltyPoints: 345,
    tier: "Platinum",
    lastVisit: "2024-01-16"
  },
];

export default function Customers() {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredCustomers = customers.filter(customer =>
    customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.phone.includes(searchTerm)
  );

  const getTierBadge = (tier: string) => {
    const colors = {
      Bronze: "bg-amber-100 text-amber-800",
      Silver: "bg-gray-100 text-gray-800", 
      Gold: "bg-yellow-100 text-yellow-800",
      Platinum: "bg-purple-100 text-purple-800"
    };
    return <Badge className={colors[tier as keyof typeof colors]}>{tier}</Badge>;
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">Customers</h1>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Add Customer
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Customers</p>
                  <p className="text-2xl font-bold">892</p>
                </div>
                <Users className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">New This Month</p>
                  <p className="text-2xl font-bold">67</p>
                </div>
                <Plus className="h-8 w-8 text-success" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Active This Week</p>
                  <p className="text-2xl font-bold">234</p>
                </div>
                <Star className="h-8 w-8 text-warning" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Avg. Order Value</p>
                  <p className="text-2xl font-bold">$89.50</p>
                </div>
                <Badge className="bg-accent text-accent-foreground">AOV</Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row gap-4 justify-between">
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Customer Database
              </CardTitle>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search customers..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-80"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Total Spent</TableHead>
                  <TableHead>Orders</TableHead>
                  <TableHead>Loyalty Points</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Last Visit</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCustomers.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{customer.name}</p>
                        <p className="text-sm text-muted-foreground">ID: #{customer.id.toString().padStart(4, '0')}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          <Mail className="h-3 w-3" />
                          {customer.email}
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <Phone className="h-3 w-3" />
                          {customer.phone}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium text-success">
                      ${customer.totalSpent.toFixed(2)}
                    </TableCell>
                    <TableCell>{customer.totalOrders}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Star className="h-3 w-3 text-warning" />
                        {customer.loyaltyPoints}
                      </div>
                    </TableCell>
                    <TableCell>
                      {getTierBadge(customer.tier)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {customer.lastVisit}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="outline" size="icon" className="h-8 w-8">
                          <Eye className="h-3 w-3" />
                        </Button>
                        <Button variant="outline" size="icon" className="h-8 w-8">
                          <Edit className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}