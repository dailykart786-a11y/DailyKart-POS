import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  DollarSign, 
  ShoppingCart, 
  Package, 
  Users, 
  TrendingUp, 
  AlertTriangle,
  Plus,
  Eye
} from "lucide-react";

const stats = [
  {
    title: "Today's Sales",
    value: "$2,847.50",
    change: "+12.5%",
    icon: DollarSign,
    color: "text-success"
  },
  {
    title: "Transactions",
    value: "156",
    change: "+8.2%",
    icon: ShoppingCart,
    color: "text-primary"
  },
  {
    title: "Products",
    value: "1,247",
    change: "0",
    icon: Package,
    color: "text-accent"
  },
  {
    title: "Customers",
    value: "892",
    change: "+3.1%",
    icon: Users,
    color: "text-muted-foreground"
  }
];

const recentTransactions = [
  { id: "TXN001", customer: "John Doe", amount: "$45.99", time: "2 min ago", status: "completed" },
  { id: "TXN002", customer: "Sarah Smith", amount: "$127.50", time: "5 min ago", status: "completed" },
  { id: "TXN003", customer: "Mike Johnson", amount: "$89.00", time: "8 min ago", status: "completed" },
  { id: "TXN004", customer: "Emily Davis", amount: "$34.75", time: "12 min ago", status: "completed" },
];

const lowStockItems = [
  { name: "Coca Cola 330ml", stock: 8, minimum: 50, category: "Beverages" },
  { name: "White Bread", stock: 12, minimum: 30, category: "Bakery" },
  { name: "Milk 1L", stock: 15, minimum: 40, category: "Dairy" },
  { name: "Bananas", stock: 5, minimum: 25, category: "Fruits" },
];

export function Dashboard() {
  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      <div className="flex gap-4 flex-wrap">
        <Button className="gap-2">
          <ShoppingCart className="h-4 w-4" />
          New Sale
        </Button>
        <Button variant="outline" className="gap-2">
          <Plus className="h-4 w-4" />
          Add Product
        </Button>
        <Button variant="outline" className="gap-2">
          <Users className="h-4 w-4" />
          Add Customer
        </Button>
        <Button variant="outline" className="gap-2">
          <Eye className="h-4 w-4" />
          Daily Report
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              {stat.change !== "0" && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  {stat.change} from yesterday
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Transactions */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentTransactions.map((transaction) => (
                <div key={transaction.id} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{transaction.customer}</p>
                    <p className="text-sm text-muted-foreground">{transaction.id} • {transaction.time}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{transaction.amount}</p>
                    <Badge variant="secondary">{transaction.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Low Stock Alert */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Low Stock Alert
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {lowStockItems.map((item, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">{item.category}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm">
                      <span className="text-warning font-medium">{item.stock}</span>
                      <span className="text-muted-foreground"> / {item.minimum}</span>
                    </p>
                    <Badge variant="outline" className="text-warning border-warning">
                      Low Stock
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}