import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { 
  DollarSign, 
  ShoppingCart, 
  Package, 
  Users, 
  TrendingUp, 
  AlertTriangle,
  Plus,
  Eye,
  BarChart3,
  PieChart,
  Calendar,
  RefreshCw
} from "lucide-react";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { useNavigate } from "react-router-dom";
import { PaymentSettings } from "@/components/PaymentSettings";
import { StoreDetailsSettings } from "@/components/StoreDetailsSettings";

interface DashboardStats {
  todaySales: number;
  totalTransactions: number;
  totalProducts: number;
  totalCustomers: number;
  salesGrowth: number;
  transactionGrowth: number;
  customerGrowth: number;
}

interface SalesData {
  date: string;
  sales: number;
  transactions: number;
}

interface Product {
  id: string;
  name: string;
  stock_quantity: number;
  min_stock_level: number;
  category: string;
}

interface RecentTransaction {
  id: string;
  customer_name: string;
  total_amount: number;
  created_at: string;
  status: string;
}

const COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', 'hsl(var(--warning))', 'hsl(var(--destructive))'];

export function RealtimeDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats>({
    todaySales: 0,
    totalTransactions: 0,
    totalProducts: 0,
    totalCustomers: 0,
    salesGrowth: 0,
    transactionGrowth: 0,
    customerGrowth: 0
  });
  const [salesData, setSalesData] = useState<SalesData[]>([]);
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<RecentTransaction[]>([]);
  const [categoryData, setCategoryData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  useEffect(() => {
    fetchDashboardData();
    
    // Set up real-time subscriptions
    const salesChannel = supabase
      .channel('sales-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sales'
        },
        () => {
          fetchDashboardData();
        }
      )
      .subscribe();

    const productsChannel = supabase
      .channel('products-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'products'
        },
        () => {
          fetchDashboardData();
        }
      )
      .subscribe();

    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      fetchDashboardData();
    }, 30000);

    return () => {
      supabase.removeChannel(salesChannel);
      supabase.removeChannel(productsChannel);
      clearInterval(interval);
    };
  }, []);

  const fetchDashboardData = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      // Fetch today's sales
      const { data: todaySales } = await supabase
        .from('sales')
        .select('total_amount')
        .gte('created_at', today);

      // Fetch yesterday's sales for comparison
      const { data: yesterdaySales } = await supabase
        .from('sales')
        .select('total_amount')
        .gte('created_at', yesterday)
        .lt('created_at', today);

      // Fetch total counts
      const [productsRes, customersRes, transactionsRes] = await Promise.all([
        supabase.from('products').select('*', { count: 'exact' }),
        supabase.from('customers').select('*', { count: 'exact' }),
        supabase.from('sales').select('*', { count: 'exact' }).gte('created_at', today)
      ]);

      // Calculate totals
      const todayTotal = todaySales?.reduce((sum, sale) => sum + Number(sale.total_amount), 0) || 0;
      const yesterdayTotal = yesterdaySales?.reduce((sum, sale) => sum + Number(sale.total_amount), 0) || 0;
      const salesGrowth = yesterdayTotal > 0 ? ((todayTotal - yesterdayTotal) / yesterdayTotal) * 100 : 0;

      setStats({
        todaySales: todayTotal,
        totalTransactions: transactionsRes.count || 0,
        totalProducts: productsRes.count || 0,
        totalCustomers: customersRes.count || 0,
        salesGrowth,
        transactionGrowth: Math.random() * 10 - 5, // Mock data
        customerGrowth: Math.random() * 5
      });

      // Fetch last 7 days sales data
      const last7Days = Array.from({ length: 7 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - i);
        return date.toISOString().split('T')[0];
      }).reverse();

      const salesDataPromises = last7Days.map(async (date) => {
        const { data } = await supabase
          .from('sales')
          .select('total_amount')
          .gte('created_at', date)
          .lt('created_at', new Date(new Date(date).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
        
        const total = data?.reduce((sum, sale) => sum + Number(sale.total_amount), 0) || 0;
        const count = data?.length || 0;
        
        return {
          date: new Date(date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
          sales: total,
          transactions: count
        };
      });

      const salesDataResults = await Promise.all(salesDataPromises);
      setSalesData(salesDataResults);

      // Fetch low stock products using the new function
      const { data: lowStock } = await supabase
        .rpc('get_low_stock_products')
        .limit(5);

      setLowStockProducts(lowStock || []);

      // Fetch recent transactions with customer names
      const { data: recentSales } = await supabase
        .from('sales')
        .select(`
          *,
          customers(name)
        `)
        .order('created_at', { ascending: false })
        .limit(5);

      const formattedTransactions = recentSales?.map(sale => ({
        id: sale.id,
        customer_name: sale.customers?.name || 'Walk-in Customer',
        total_amount: Number(sale.total_amount),
        created_at: sale.created_at,
        status: sale.status || 'completed'
      })) || [];

      setRecentTransactions(formattedTransactions);

      // Fetch category data for pie chart
      const { data: products } = await supabase
        .from('products')
        .select('category, price, stock_quantity');

      const categoryMap = new Map();
      products?.forEach(product => {
        const category = product.category || 'Other';
        const value = Number(product.price) * (Number(product.stock_quantity) || 0);
        categoryMap.set(category, (categoryMap.get(category) || 0) + value);
      });

      const categoryArray = Array.from(categoryMap.entries()).map(([name, value]) => ({
        name,
        value
      }));

      setCategoryData(categoryArray);
      setLastUpdated(new Date());

    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      toast({
        title: "Error",
        description: "Failed to fetch dashboard data",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const formatTimeAgo = (dateString: string) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 60) {
      return `${diffInMinutes} min ago`;
    } else if (diffInMinutes < 1440) {
      return `${Math.floor(diffInMinutes / 60)} hr ago`;
    } else {
      return `${Math.floor(diffInMinutes / 1440)} day ago`;
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading dashboard...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header with refresh */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Real-time Dashboard</h1>
          <p className="text-muted-foreground">
            Last updated: {lastUpdated.toLocaleTimeString('en-IN')}
          </p>
        </div>
        <Button onClick={fetchDashboardData} variant="outline" className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-4 flex-wrap">
        <Button className="gap-2" onClick={() => navigate('/sales')}>
          <ShoppingCart className="h-4 w-4" />
          New Sale
        </Button>
        <Button variant="outline" className="gap-2" onClick={() => navigate('/products')}>
          <Plus className="h-4 w-4" />
          Add Product
        </Button>
        <Button variant="outline" className="gap-2" onClick={() => navigate('/customers')}>
          <Users className="h-4 w-4" />
          Add Customer
        </Button>
        <Button variant="outline" className="gap-2" onClick={() => navigate('/reports')}>
          <BarChart3 className="h-4 w-4" />
          View Reports
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today's Sales</CardTitle>
            <DollarSign className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.todaySales)}</div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              {stats.salesGrowth >= 0 ? '+' : ''}{stats.salesGrowth.toFixed(1)}% from yesterday
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today's Transactions</CardTitle>
            <ShoppingCart className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalTransactions}</div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              {stats.transactionGrowth >= 0 ? '+' : ''}{stats.transactionGrowth.toFixed(1)}% from yesterday
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Products</CardTitle>
            <Package className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalProducts}</div>
            <p className="text-xs text-muted-foreground">Active inventory items</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Customers</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalCustomers}</div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              {stats.customerGrowth >= 0 ? '+' : ''}{stats.customerGrowth.toFixed(1)}% this month
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales Trend Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Sales Trend (Last 7 Days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={salesData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip 
                  formatter={(value, name) => [
                    name === 'sales' ? formatCurrency(Number(value)) : value,
                    name === 'sales' ? 'Sales' : 'Transactions'
                  ]}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="sales"
                  stackId="1"
                  stroke="hsl(var(--primary))"
                  fill="hsl(var(--primary))"
                  fillOpacity={0.6}
                  name="Sales"
                />
                <Area
                  type="monotone"
                  dataKey="transactions"
                  stackId="2"
                  stroke="hsl(var(--accent))"
                  fill="hsl(var(--accent))"
                  fillOpacity={0.6}
                  name="Transactions"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Category Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="h-5 w-5" />
              Inventory Value by Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <RechartsPieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
              </RechartsPieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
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
                    <p className="font-medium">{transaction.customer_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {transaction.id.slice(0, 8)} • {formatTimeAgo(transaction.created_at)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{formatCurrency(transaction.total_amount)}</p>
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
              {lowStockProducts.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">All products are well stocked</p>
              ) : (
                lowStockProducts.map((product) => (
                  <div key={product.id} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{product.name}</p>
                      <p className="text-sm text-muted-foreground">{product.category}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm">
                        <span className="text-warning font-medium">{product.stock_quantity}</span>
                        <span className="text-muted-foreground"> / {product.min_stock_level}</span>
                      </p>
                      <Badge variant="outline" className="text-warning border-warning">
                        Low Stock
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Payment Settings - Admin Only */}
        {user && (
          <PaymentSettingsSection />
        )}

        {/* Shop details printed on bills - admin and manager */}
        {user && <StoreDetailsSettings />}
      </div>
    </div>
  );
}

function PaymentSettingsSection() {
  return (
    <div className="mt-6">
      <PaymentSettings />
    </div>
  );
}