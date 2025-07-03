import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Calendar, Download, Filter, Receipt } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Sale {
  id: string;
  invoice_number: string;
  total_amount: number;
  tax_amount: number | null;
  payment_method: string | null;
  created_at: string | null;
  customer_id: string | null;
  cashier_id: string;
  status: string | null;
}

interface SaleItem {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  gst_amount: number | null;
  products: {
    name: string;
    sku: string;
  };
}

export function AdminSalesView() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [salesRes, customersRes, profilesRes] = await Promise.all([
        supabase.from('sales').select('*').order('created_at', { ascending: false }),
        supabase.from('customers').select('*'),
        supabase.from('profiles').select('*')
      ]);

      if (salesRes.error) throw salesRes.error;
      if (customersRes.error) throw customersRes.error;
      if (profilesRes.error) throw profilesRes.error;

      setSales(salesRes.data || []);
      setCustomers(customersRes.data || []);
      setProfiles(profilesRes.data || []);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch sales data",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchSaleItems = async (saleId: string) => {
    try {
      const { data, error } = await supabase
        .from('sale_items')
        .select(`
          *,
          products (name, sku)
        `)
        .eq('sale_id', saleId);

      if (error) throw error;
      setSaleItems(data || []);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch sale items",
        variant: "destructive"
      });
    }
  };

  const handleViewSale = (sale: Sale) => {
    setSelectedSale(sale);
    fetchSaleItems(sale.id);
  };

  const getCustomerName = (customerId: string | null) => {
    if (!customerId) return "Walk-in Customer";
    const customer = customers.find(c => c.id === customerId);
    return customer?.name || "Unknown";
  };

  const getCashierName = (cashierId: string) => {
    const cashier = profiles.find(p => p.user_id === cashierId);
    return cashier?.full_name || "Unknown";
  };

  const applyFilters = () => {
    let filtered = sales;

    if (dateFrom) {
      filtered = filtered.filter(sale => 
        sale.created_at && new Date(sale.created_at) >= new Date(dateFrom)
      );
    }

    if (dateTo) {
      filtered = filtered.filter(sale => 
        sale.created_at && new Date(sale.created_at) <= new Date(dateTo)
      );
    }

    if (paymentMethodFilter) {
      filtered = filtered.filter(sale => sale.payment_method === paymentMethodFilter);
    }

    return filtered;
  };

  const exportToCSV = () => {
    const filteredSales = applyFilters();
    
    const csvContent = [
      ['Invoice Number', 'Date', 'Customer', 'Cashier', 'Payment Method', 'Subtotal', 'GST', 'Total', 'Status'].join(','),
      ...filteredSales.map(sale => [
        sale.invoice_number,
        sale.created_at ? new Date(sale.created_at).toLocaleDateString('en-IN') : '',
        getCustomerName(sale.customer_id),
        getCashierName(sale.cashier_id),
        sale.payment_method || '',
        (sale.total_amount - (sale.tax_amount || 0)).toFixed(2),
        (sale.tax_amount || 0).toFixed(2),
        sale.total_amount.toFixed(2),
        sale.status || 'completed'
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const filteredSales = applyFilters();
  const totalRevenue = filteredSales.reduce((sum, sale) => sum + sale.total_amount, 0);
  const totalGST = filteredSales.reduce((sum, sale) => sum + (sale.tax_amount || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Sales Management</h2>
          <p className="text-muted-foreground">View and manage all sales transactions</p>
        </div>
        <Button onClick={exportToCSV} className="gap-2">
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Sales</p>
                <p className="text-2xl font-bold">{filteredSales.length}</p>
              </div>
              <Receipt className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
                <p className="text-2xl font-bold">₹{totalRevenue.toLocaleString('en-IN')}</p>
              </div>
              <Calendar className="h-8 w-8 text-success" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total GST</p>
                <p className="text-2xl font-bold">₹{totalGST.toLocaleString('en-IN')}</p>
              </div>
              <Filter className="h-8 w-8 text-accent" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Net Revenue</p>
                <p className="text-2xl font-bold">₹{(totalRevenue - totalGST).toLocaleString('en-IN')}</p>
              </div>
              <Download className="h-8 w-8 text-warning" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dateFrom">From Date</Label>
              <Input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dateTo">To Date</Label>
              <Input
                id="dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="paymentMethod">Payment Method</Label>
              <Select value={paymentMethodFilter} onValueChange={setPaymentMethodFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All payment methods" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="credit">Credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sales Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Sales Transactions ({filteredSales.length} records)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-4">Loading sales...</div>
          ) : filteredSales.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No sales found.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Cashier</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSales.map((sale) => (
                  <TableRow key={sale.id}>
                    <TableCell className="font-mono">{sale.invoice_number}</TableCell>
                    <TableCell>
                      {sale.created_at 
                        ? new Date(sale.created_at).toLocaleDateString('en-IN')
                        : "N/A"
                      }
                    </TableCell>
                    <TableCell>{getCustomerName(sale.customer_id)}</TableCell>
                    <TableCell>{getCashierName(sale.cashier_id)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {sale.payment_method?.toUpperCase() || "N/A"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      ₹{sale.total_amount.toLocaleString('en-IN')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={sale.status === 'completed' ? 'default' : 'secondary'}>
                        {sale.status || 'completed'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleViewSale(sale)}
                      >
                        View Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Sale Details Modal */}
      {selectedSale && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Sale Details - {selectedSale.invoice_number}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div>
                <p className="text-sm text-muted-foreground">Customer</p>
                <p className="font-medium">{getCustomerName(selectedSale.customer_id)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Cashier</p>
                <p className="font-medium">{getCashierName(selectedSale.cashier_id)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Payment Method</p>
                <p className="font-medium">{selectedSale.payment_method || "N/A"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Date</p>
                <p className="font-medium">
                  {selectedSale.created_at 
                    ? new Date(selectedSale.created_at).toLocaleDateString('en-IN')
                    : "N/A"
                  }
                </p>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Unit Price</TableHead>
                  <TableHead>GST</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {saleItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.products.name}</TableCell>
                    <TableCell className="font-mono">{item.products.sku}</TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>₹{item.unit_price.toLocaleString('en-IN')}</TableCell>
                    <TableCell>₹{(item.gst_amount || 0).toLocaleString('en-IN')}</TableCell>
                    <TableCell className="font-medium">₹{item.total_price.toLocaleString('en-IN')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="mt-4 space-y-2 border-t pt-4">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>₹{(selectedSale.total_amount - (selectedSale.tax_amount || 0)).toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between">
                <span>GST:</span>
                <span>₹{(selectedSale.tax_amount || 0).toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between font-bold text-lg">
                <span>Total:</span>
                <span>₹{selectedSale.total_amount.toLocaleString('en-IN')}</span>
              </div>
            </div>

            <Button 
              variant="outline" 
              onClick={() => setSelectedSale(null)}
              className="mt-4"
            >
              Close
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}