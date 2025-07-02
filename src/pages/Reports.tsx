import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePickerWithRange } from "@/components/ui/date-picker";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { 
  FileText, 
  Download, 
  Calendar,
  TrendingUp,
  DollarSign,
  ShoppingCart,
  Users,
  Package
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { DateRange } from "react-day-picker";

interface ReportData {
  salesReport: any[];
  profitReport: any[];
  customerReport: any[];
  productReport: any[];
  expenseReport: any[];
}

const COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', 'hsl(var(--warning))', 'hsl(var(--destructive))'];

export default function Reports() {
  const [reportType, setReportType] = useState("sales");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [reportData, setReportData] = useState<ReportData>({
    salesReport: [],
    profitReport: [],
    customerReport: [],
    productReport: [],
    expenseReport: []
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    generateReport();
  }, [reportType, dateRange]);

  const generateReport = async () => {
    setLoading(true);
    try {
      const startDate = dateRange?.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = dateRange?.to || new Date();

      switch (reportType) {
        case "sales":
          await generateSalesReport(startDate, endDate);
          break;
        case "profit":
          await generateProfitReport(startDate, endDate);
          break;
        case "customer":
          await generateCustomerReport(startDate, endDate);
          break;
        case "product":
          await generateProductReport(startDate, endDate);
          break;
        case "expense":
          await generateExpenseReport(startDate, endDate);
          break;
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate report",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const generateSalesReport = async (startDate: Date, endDate: Date) => {
    const { data: sales } = await supabase
      .from('sales')
      .select(`
        *,
        customers(name),
        sale_items(quantity, unit_price, total_price, products(name, category))
      `)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: true });

    // Group by date
    const dailySales = sales?.reduce((acc: any, sale) => {
      const date = new Date(sale.created_at).toISOString().split('T')[0];
      if (!acc[date]) {
        acc[date] = { date, sales: 0, transactions: 0, tax: 0 };
      }
      acc[date].sales += Number(sale.total_amount);
      acc[date].transactions += 1;
      acc[date].tax += Number(sale.tax_amount || 0);
      return acc;
    }, {});

    const salesReport = Object.values(dailySales || {}).map((day: any) => ({
      ...day,
      date: new Date(day.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
    }));

    setReportData(prev => ({ ...prev, salesReport }));
  };

  const generateProfitReport = async (startDate: Date, endDate: Date) => {
    const { data: sales } = await supabase
      .from('sales')
      .select(`
        *,
        sale_items(quantity, unit_price, total_price, products(cost_price, name))
      `)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    const profitData = sales?.map(sale => {
      const revenue = Number(sale.total_amount);
      const cost = sale.sale_items?.reduce((acc: number, item: any) => {
        return acc + (Number(item.quantity) * Number(item.products?.cost_price || 0));
      }, 0) || 0;
      const profit = revenue - cost;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

      return {
        date: new Date(sale.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
        revenue,
        cost,
        profit,
        margin
      };
    }) || [];

    setReportData(prev => ({ ...prev, profitReport: profitData }));
  };

  const generateCustomerReport = async (startDate: Date, endDate: Date) => {
    const { data: customers } = await supabase
      .from('customers')
      .select(`
        *,
        sales(total_amount, created_at)
      `)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    const customerReport = customers?.map(customer => {
      const totalSpent = customer.sales?.reduce((sum: number, sale: any) => sum + Number(sale.total_amount), 0) || 0;
      const totalOrders = customer.sales?.length || 0;
      const avgOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0;

      return {
        name: customer.name,
        totalSpent,
        totalOrders,
        avgOrderValue,
        loyaltyPoints: customer.loyalty_points || 0
      };
    }).sort((a, b) => b.totalSpent - a.totalSpent) || [];

    setReportData(prev => ({ ...prev, customerReport }));
  };

  const generateProductReport = async (startDate: Date, endDate: Date) => {
    const { data: saleItems } = await supabase
      .from('sale_items')
      .select(`
        *,
        products(name, category, price, cost_price),
        sales(created_at)
      `)
      .gte('sales.created_at', startDate.toISOString())
      .lte('sales.created_at', endDate.toISOString());

    const productSales = saleItems?.reduce((acc: any, item) => {
      const productName = item.products?.name || 'Unknown';
      if (!acc[productName]) {
        acc[productName] = {
          name: productName,
          category: item.products?.category,
          quantitySold: 0,
          revenue: 0,
          profit: 0
        };
      }
      acc[productName].quantitySold += Number(item.quantity);
      acc[productName].revenue += Number(item.total_price);
      acc[productName].profit += Number(item.total_price) - (Number(item.quantity) * Number(item.products?.cost_price || 0));
      return acc;
    }, {});

    const productReport = Object.values(productSales || {}).sort((a: any, b: any) => b.revenue - a.revenue);

    setReportData(prev => ({ ...prev, productReport }));
  };

  const generateExpenseReport = async (startDate: Date, endDate: Date) => {
    const { data: expenses } = await supabase
      .from('expenses')
      .select('*')
      .gte('date', startDate.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0]);

    const expenseByCategory = expenses?.reduce((acc: any, expense) => {
      const category = expense.category;
      if (!acc[category]) {
        acc[category] = { category, amount: 0 };
      }
      acc[category].amount += Number(expense.amount);
      return acc;
    }, {});

    const expenseReport = Object.values(expenseByCategory || {});

    setReportData(prev => ({ ...prev, expenseReport }));
  };

  const exportReport = () => {
    const dataToExport = reportData[`${reportType}Report` as keyof ReportData];
    const csv = convertToCSV(dataToExport);
    downloadCSV(csv, `${reportType}-report-${new Date().toISOString().split('T')[0]}.csv`);
  };

  const convertToCSV = (data: any[]) => {
    if (!data.length) return '';
    
    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map(row => headers.map(header => row[header]).join(','))
    ].join('\n');
    
    return csvContent;
  };

  const downloadCSV = (csv: string, filename: string) => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const renderChart = () => {
    switch (reportType) {
      case "sales":
        return (
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={reportData.salesReport}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip formatter={(value, name) => [
                name === 'sales' || name === 'tax' ? formatCurrency(Number(value)) : value,
                name
              ]} />
              <Legend />
              <Bar dataKey="sales" fill="hsl(var(--primary))" name="Sales" />
              <Bar dataKey="transactions" fill="hsl(var(--accent))" name="Transactions" />
              <Bar dataKey="tax" fill="hsl(var(--warning))" name="Tax" />
            </BarChart>
          </ResponsiveContainer>
        );
      
      case "profit":
        return (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={reportData.profitReport}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip formatter={(value, name) => [
                name !== 'margin' ? formatCurrency(Number(value)) : `${Number(value).toFixed(1)}%`,
                name
              ]} />
              <Legend />
              <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" name="Revenue" />
              <Line type="monotone" dataKey="cost" stroke="hsl(var(--destructive))" name="Cost" />
              <Line type="monotone" dataKey="profit" stroke="hsl(var(--accent))" name="Profit" />
            </LineChart>
          </ResponsiveContainer>
        );
      
      case "product":
        return (
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={reportData.productReport.slice(0, 10)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
              <YAxis />
              <Tooltip formatter={(value, name) => [
                name === 'revenue' || name === 'profit' ? formatCurrency(Number(value)) : value,
                name
              ]} />
              <Legend />
              <Bar dataKey="quantitySold" fill="hsl(var(--primary))" name="Qty Sold" />
              <Bar dataKey="revenue" fill="hsl(var(--accent))" name="Revenue" />
            </BarChart>
          </ResponsiveContainer>
        );
      
      case "expense":
        return (
          <ResponsiveContainer width="100%" height={400}>
            <PieChart>
              <Pie
                data={reportData.expenseReport}
                cx="50%"
                cy="50%"
                outerRadius={120}
                fill="#8884d8"
                dataKey="amount"
                label={({ category, percent }) => `${category} ${(percent * 100).toFixed(0)}%`}
              >
                {reportData.expenseReport.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => formatCurrency(Number(value))} />
            </PieChart>
          </ResponsiveContainer>
        );
      
      default:
        return <div>Select a report type</div>;
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Advanced Reports</h1>
            <p className="text-muted-foreground">Comprehensive business analytics and insights</p>
          </div>
          <Button onClick={exportReport} className="gap-2">
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>

        {/* Report Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Report Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="flex gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium mb-2 block">Report Type</label>
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sales">Sales Report</SelectItem>
                  <SelectItem value="profit">Profit & Loss</SelectItem>
                  <SelectItem value="customer">Customer Analysis</SelectItem>
                  <SelectItem value="product">Product Performance</SelectItem>
                  <SelectItem value="expense">Expense Breakdown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex-1 min-w-[300px]">
              <label className="text-sm font-medium mb-2 block">Date Range</label>
              <DatePickerWithRange date={dateRange} setDate={setDateRange} />
            </div>
            
            <div className="flex items-end">
              <Button onClick={generateReport} disabled={loading}>
                {loading ? "Generating..." : "Generate Report"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Chart Display */}
        <Card>
          <CardHeader>
            <CardTitle className="capitalize">{reportType} Report</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center h-64">
                Generating report...
              </div>
            ) : (
              renderChart()
            )}
          </CardContent>
        </Card>

        {/* Summary Stats for Current Report */}
        {reportType === "sales" && reportData.salesReport.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-success" />
                  <span className="text-sm font-medium">Total Sales</span>
                </div>
                <div className="text-2xl font-bold">
                  {formatCurrency(reportData.salesReport.reduce((sum, day) => sum + day.sales, 0))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Total Transactions</span>
                </div>
                <div className="text-2xl font-bold">
                  {reportData.salesReport.reduce((sum, day) => sum + day.transactions, 0)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-accent" />
                  <span className="text-sm font-medium">Avg. Transaction</span>
                </div>
                <div className="text-2xl font-bold">
                  {formatCurrency(
                    reportData.salesReport.reduce((sum, day) => sum + day.sales, 0) /
                    Math.max(reportData.salesReport.reduce((sum, day) => sum + day.transactions, 0), 1)
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </Layout>
  );
}