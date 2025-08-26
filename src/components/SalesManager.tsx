import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CustomerEntryDialog } from "@/components/CustomerEntryDialog";
import { WhatsAppIntegration } from "@/components/WhatsAppIntegration";
import { AddCustomerDialog } from "@/components/AddCustomerDialog";
import { Plus, Minus, Search, ShoppingCart, CreditCard, Smartphone, Trash2, Calculator } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Product {
  id: string;
  name: string;
  price: number;
  stock_quantity: number | null;
  sku: string;
  gst_rate: number | null;
  category: string | null;
  image_url: string | null;
}

interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  loyalty_points: number;
}

interface CartItem {
  product: Product;
  quantity: number;
  discount: number;
}

interface Sale {
  id: string;
  invoice_number: string;
  total_amount: number;
  payment_method?: string;
  created_at: string;
  customer_id?: string;
}

interface SaleItem {
  id: string;
  product: Product;
  quantity: number;
  unit_price: number;
  total_price: number;
  gst_amount: number;
}

export function SalesManager() {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [showCustomerDialog, setShowCustomerDialog] = useState(false);
  const [customerEntryLoading, setCustomerEntryLoading] = useState(false);
  const [upiDialogOpen, setUpiDialogOpen] = useState(false);
  const [lastSale, setLastSale] = useState<any | null>(null);
  const [lastSaleItems, setLastSaleItems] = useState<CartItem[]>([]);
  const [paymentSettings, setPaymentSettings] = useState<{ upi_vpa: string; payee_name?: string } | null>(null);

  useEffect(() => {
    fetchData();
    fetchPaymentSettings();
  }, []);

  const fetchData = async () => {
    try {
      const [productsRes, customersRes] = await Promise.all([
        supabase.from('products').select('*').eq('is_active', true),
        supabase.from('customers').select('*')
      ]);

      if (productsRes.error) throw productsRes.error;
      if (customersRes.error) throw customersRes.error;

      setProducts(productsRes.data || []);
      setCustomers(customersRes.data || []);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch data",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchPaymentSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('payment_settings')
        .select('upi_vpa, payee_name')
        .limit(1)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching payment settings:', error);
        return;
      }

      if (data) {
        setPaymentSettings(data);
      }
    } catch (error) {
      console.error('Error fetching payment settings:', error);
    }
  };

  const addToCart = (product: Product) => {
    const existingItem = cart.find(item => item.product.id === product.id);
    
    if (existingItem) {
      setCart(cart.map(item =>
        item.product.id === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setCart([...cart, { product, quantity: 1, discount: 0 }]);
    }
  };

  const updateCartQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    
    setCart(cart.map(item =>
      item.product.id === productId
        ? { ...item, quantity }
        : item
    ));
  };

  const updateCartDiscount = (productId: string, discount: number) => {
    setCart(cart.map(item =>
      item.product.id === productId
        ? { ...item, discount: Math.max(0, Math.min(100, discount)) }
        : item
    ));
  };

  const removeFromCart = (productId: string) => {
    setCart(cart.filter(item => item.product.id !== productId));
  };

  const calculateItemTotal = (item: CartItem) => {
    const baseTotal = item.product.price * item.quantity;
    const discountAmount = (baseTotal * item.discount) / 100;
    const subtotalAfterDiscount = baseTotal - discountAmount;
    const gstAmount = calculateGST(item);
    return subtotalAfterDiscount + gstAmount;
  };

  const calculateGST = (item: CartItem) => {
    const basePrice = item.product.price * item.quantity;
    const discountAmount = (basePrice * item.discount) / 100;
    const discountedPrice = basePrice - discountAmount;
    const gstRate = item.product.gst_rate || 0;
    return Math.round((discountedPrice * gstRate) / 100 * 100) / 100;
  };

  const getCartTotals = () => {
    const subtotalBeforeGST = cart.reduce((sum, item) => {
      const baseTotal = item.product.price * item.quantity;
      const discountAmount = (baseTotal * item.discount) / 100;
      return sum + (baseTotal - discountAmount);
    }, 0);
    
    const totalGST = cart.reduce((sum, item) => sum + calculateGST(item), 0);
    const total = Math.round((subtotalBeforeGST + totalGST) * 100) / 100;
    
    return { 
      subtotal: Math.round(subtotalBeforeGST * 100) / 100, 
      totalGST: Math.round(totalGST * 100) / 100, 
      total 
    };
  };

  const handleCompleteSale = () => {
    if (cart.length === 0) {
      toast({
        title: "Error",
        description: "Cart is empty",
        variant: "destructive"
      });
      return;
    }
    setShowCustomerDialog(true);
  };

  const handleCustomerSubmit = async (customerData: { name: string; phone: string; email: string; address: string }) => {
    setCustomerEntryLoading(true);
    
    try {
      let customerId = null;
      
      // Create customer if name is provided
      if (customerData.name.trim()) {
        const { data: customer, error: customerError } = await supabase
          .from('customers')
          .insert({
            name: customerData.name.trim(),
            phone: customerData.phone.trim() || null,
            email: customerData.email.trim() || null,
            address: customerData.address.trim() || null
          })
          .select()
          .single();

        if (customerError) throw customerError;
        customerId = customer.id;
      }

      await processSale(customerId);
      setShowCustomerDialog(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create customer",
        variant: "destructive"
      });
    } finally {
      setCustomerEntryLoading(false);
    }
  };

  const processSale = async (customerId?: string | null) => {
    if (!user) return;

    try {
      const { subtotal, totalGST, total } = getCartTotals();
      const invoiceNumber = `INV-${Date.now()}`;

      const { data: sale, error: saleError } = await supabase
        .from('sales')
        .insert({
          customer_id: customerId || selectedCustomer || null,
          cashier_id: user.id,
          total_amount: total,
          tax_amount: totalGST,
          invoice_number: invoiceNumber,
          payment_method: paymentMethod
        })
        .select()
        .single();

      if (saleError) throw saleError;

      // Create sale items
      const saleItems = cart.map(item => ({
        sale_id: sale.id,
        product_id: item.product.id,
        quantity: item.quantity,
        unit_price: item.product.price,
        total_price: calculateItemTotal(item),
        gst_amount: calculateGST(item)
      }));

      const { error: itemsError } = await supabase
        .from('sale_items')
        .insert(saleItems);

      if (itemsError) throw itemsError;

      // Update product stock
      for (const item of cart) {
        const newStock = (item.product.stock_quantity || 0) - item.quantity;
        await supabase
          .from('products')
          .update({ stock_quantity: Math.max(0, newStock) })
          .eq('id', item.product.id);
      }

      // Note: Loyalty points feature removed as per business requirements

      toast({
        title: "Sale Completed",
        description: `Invoice ${invoiceNumber} generated successfully`
      });

      // Store last sale for printing/sharing
      setLastSale(sale);
      setLastSaleItems(cart);

      // Reset cart and form
      setCart([]);
      setSelectedCustomer("");
      setPaymentMethod("cash");
      fetchData(); // Refresh product data
      fetchPaymentSettings(); // Refresh payment settings

    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to process sale",
        variant: "destructive"
      });
    }
  };

  const filteredProducts = products.filter((product) => {
    const matchesSearch =
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.sku.toLowerCase().includes(searchTerm.toLowerCase());
    const productCategory = (product.category?.trim() || "Uncategorized");
    const matchesCategory = categoryFilter === "all" || productCategory === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const { subtotal, totalGST, total } = getCartTotals();
  const categories = Array.from(new Set(products.map(p => (p.category?.trim() || "Uncategorized"))));

  // UPI payment link - use settings from database or fallback
  const vpa = paymentSettings?.upi_vpa || "6302242108@kotak811";
  const payeeName = paymentSettings?.payee_name || "DailyKart";
  const upiAmount = total.toFixed(2);
  const upiNote = lastSale?.invoice_number ? `Invoice ${lastSale.invoice_number}` : "POS Payment";
  const upiUrl = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(payeeName)}&am=${encodeURIComponent(upiAmount)}&cu=INR&tn=${encodeURIComponent(upiNote)}`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Product Selection */}
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold mb-4">Product Selection</h2>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search products by name or SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="mt-3">
            <Label>Category</Label>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent className="z-50 bg-popover">
                <SelectItem value="all">All</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 gap-2 max-h-96 overflow-y-auto">
              {loading ? (
                <div className="text-center py-4">Loading products...</div>
              ) : filteredProducts.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  No products found
                </div>
              ) : (
                filteredProducts.map((product) => (
                  <div
                    key={product.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent cursor-pointer"
                    onClick={() => addToCart(product)}
                  >
                    <div className="flex items-center gap-3 flex-1">
                      {product.image_url && (
                        <img 
                          src={product.image_url} 
                          alt={product.name}
                          className="h-12 w-12 object-cover rounded border"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                       )}
                       <div className="flex-1">
                         <p className="font-medium">{product.name}</p>
                         <p className="text-sm text-muted-foreground">
                           {product.sku} • Stock: {product.stock_quantity || 0}
                         </p>
                       </div>
                     </div>
                     <div className="text-right">
                       <p className="font-medium">₹{product.price.toLocaleString('en-IN')}</p>
                       <Button size="sm" variant="outline">
                         <Plus className="h-3 w-3" />
                       </Button>
                     </div>
                   </div>
                 ))
               )}
             </div>
          </CardContent>
        </Card>
      </div>

      {/* Cart & Checkout */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Shopping Cart</h2>
          <Badge variant="secondary">{cart.length} items</Badge>
        </div>

        {/* Customer Selection */}
        <Card>
          <CardContent className="p-4">
            <div className="space-y-2">
              <Label>Customer (Optional)</Label>
              <div className="flex gap-2">
                <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <AddCustomerDialog 
                  onCustomerAdded={(newCustomer) => {
                    setCustomers(prev => [...prev, { ...newCustomer, loyalty_points: 0 }]);
                    setSelectedCustomer(newCustomer.id);
                  }} 
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Cart Items */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              Cart Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cart.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Cart is empty. Add products to get started.
              </div>
            ) : (
              <div className="space-y-4">
                {cart.map((item) => (
                  <div key={item.product.id} className="flex items-center gap-4 p-3 border rounded-lg">
                    <div className="flex-1">
                      <p className="font-medium">{item.product.name}</p>
                      <p className="text-sm text-muted-foreground">
                        ₹{item.product.price.toLocaleString('en-IN')} each
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateCartQuantity(item.product.id, parseInt(e.target.value))}
                        className="w-16 text-center"
                      />
                      <span className="text-sm text-muted-foreground">×</span>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={item.discount}
                        onChange={(e) => updateCartDiscount(item.product.id, parseFloat(e.target.value))}
                        className="w-16 text-center"
                        placeholder="0%"
                      />
                      <span className="text-sm text-muted-foreground">%</span>
                      <div className="w-20 text-right font-medium">
                        ₹{calculateItemTotal(item).toLocaleString('en-IN')}
                      </div>
                      <Button
                        variant="destructive"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => removeFromCart(item.product.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cart Summary & Checkout */}
        {cart.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5" />
                Order Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>₹{subtotal.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between">
                  <span>GST:</span>
                  <span>₹{totalGST.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between font-bold text-lg">
                  <span>Total:</span>
                  <span>₹{total.toLocaleString('en-IN')}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="upi">UPI</SelectItem>
                    <SelectItem value="credit">Credit</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                {paymentMethod === 'upi' && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setUpiDialogOpen(true)}
                  >
                    Show UPI QR to Pay (₹{total.toLocaleString('en-IN')})
                  </Button>
                )}
                <Button 
                  onClick={handleCompleteSale} 
                  className="w-full" 
                  size="lg"
                  disabled={cart.length === 0}
                >
                  Complete Sale - ₹{total.toLocaleString('en-IN')}
                </Button>
                
                {cart.length > 0 && (
                  <WhatsAppIntegration
                    type="invoice"
                    data={{
                      items: cart.map(item => ({
                        product_name: item.product.name,
                        quantity: item.quantity,
                        total_price: calculateItemTotal(item).toLocaleString('en-IN')
                      })),
                      subtotal: subtotal.toLocaleString('en-IN'),
                      tax_amount: totalGST.toLocaleString('en-IN'),
                      total_amount: total.toLocaleString('en-IN'),
                      payment_method: paymentMethod,
                      invoice_number: `INV-${Date.now()}`,
                      created_at: new Date().toISOString()
                    }}
                    recipientPhone=""
                    recipientName={customers.find(c => c.id === selectedCustomer)?.name || ""}
                  />
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {lastSale && (
          <Card>
            <CardHeader>
              <CardTitle>Recent Sale - {lastSale.invoice_number}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span>Total</span>
                <span>₹{Number(lastSale.total_amount).toLocaleString('en-IN')}</span>
              </div>
              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => {
                  const printArea = document.getElementById('print-area');
                  if (printArea) {
                    const printWindow = window.open('', '_blank');
                    if (printWindow) {
                      printWindow.document.write(`
                        <html>
                          <head>
                            <title>Invoice - ${lastSale.invoice_number}</title>
                            <style>
                              @media print {
                                body { margin: 0; padding: 0; font-family: monospace; }
                                .print-content { width: 80mm; font-size: 12px; }
                                .center { text-align: center; }
                                .bold { font-weight: bold; }
                                .dashed { border-top: 1px dashed #000; margin: 8px 0; }
                                .flex { display: flex; justify-content: space-between; }
                                .mb-1 { margin-bottom: 4px; }
                                .mb-2 { margin-bottom: 8px; }
                                .small { font-size: 10px; }
                              }
                            </style>
                          </head>
                          <body>
                            ${printArea.innerHTML}
                          </body>
                        </html>
                      `);
                      printWindow.document.close();
                      printWindow.focus();
                      printWindow.print();
                      printWindow.close();
                    }
                  }
                }}>
                  Print 80mm Invoice
                </Button>
                <WhatsAppIntegration
                  type="invoice"
                  data={{
                    items: lastSaleItems.map(item => ({
                      product_name: item.product.name,
                      quantity: item.quantity,
                      total_price: calculateItemTotal(item).toLocaleString('en-IN')
                    })),
                    subtotal: subtotal.toLocaleString('en-IN'),
                    tax_amount: totalGST.toLocaleString('en-IN'),
                    total_amount: Number(lastSale.total_amount).toLocaleString('en-IN'),
                    payment_method: lastSale.payment_method,
                    invoice_number: lastSale.invoice_number,
                    created_at: lastSale.created_at
                  }}
                  recipientPhone=""
                  recipientName={customers.find(c => c.id === selectedCustomer)?.name || ""}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Customer Entry Dialog */}
        <CustomerEntryDialog
          open={showCustomerDialog}
          onOpenChange={setShowCustomerDialog}
          onSubmit={handleCustomerSubmit}
          isLoading={customerEntryLoading}
        />

        {/* UPI QR Dialog */}
        <Dialog open={upiDialogOpen} onOpenChange={setUpiDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Scan to Pay via UPI</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3">
              <QRCodeSVG value={upiUrl} size={200} includeMargin />
              <div className="text-center">
                <div className="text-sm text-muted-foreground">Pay to: {payeeName}</div>
                <div className="text-sm text-muted-foreground">VPA: {vpa}</div>
                <div className="font-medium">Amount: ₹{total.toLocaleString('en-IN')}</div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Hidden print area for 80mm thermal receipt */}
        <div id="print-area" className="print-content center" style={{display: 'none'}}>
          {lastSale && (
            <div className="print-content">
              <div className="center mb-2">
                <div className="mb-2">
                  <svg width="60" height="40" viewBox="0 0 100 60" className="mx-auto">
                    <rect x="5" y="5" width="90" height="50" rx="8" fill="#2563eb" />
                    <text x="50" y="25" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">DAILY</text>
                    <text x="50" y="40" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">KART</text>
                    <circle cx="20" cy="20" r="3" fill="white" />
                    <circle cx="80" cy="40" r="3" fill="white" />
                  </svg>
                </div>
                <div className="bold">DAILYKART POS</div>
                <div className="small">Your Daily Shopping Partner</div>
                <div className="small">📞 +91-XXXXX-XXXXX | 📧 info@dailykart.com</div>
              </div>
              
              <div className="dashed"></div>
              
              <div className="center mb-2">
                <div className="bold">TAX INVOICE</div>
                <div className="small">Invoice: {lastSale.invoice_number}</div>
                <div className="small">
                  Date: {new Date(lastSale.created_at || Date.now()).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
                </div>
                <div className="small">
                  Time: {new Date(lastSale.created_at || Date.now()).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}
                </div>
              </div>
              
              <div className="dashed"></div>
              
              <div className="space-y-1">
                <div className="flex justify-between font-semibold border-b pb-1">
                  <span>ITEM</span>
                  <span>QTY × RATE = AMT</span>
                </div>
                {lastSaleItems.map(item => (
                  <div key={item.product.id} className="space-y-1">
                    <div className="flex justify-between">
                      <div className="flex-1 pr-2">
                        <div className="font-medium">{item.product.name}</div>
                        <div className="text-xs text-gray-600">
                          {item.quantity} × ₹{item.product.price.toLocaleString('en-IN')}
                        </div>
                      </div>
                      <div className="text-right font-medium">
                        ₹{calculateItemTotal(item).toLocaleString('en-IN')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="my-2 border-t border-dashed" />
              
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>₹{subtotal.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between">
                  <span>GST:</span>
                  <span>₹{totalGST.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between font-bold text-lg border-t pt-1">
                  <span>TOTAL:</span>
                  <span>₹{Number(lastSale.total_amount).toLocaleString('en-IN')}</span>
                </div>
                <div className="text-center mt-2 text-sm">
                  Payment: {lastSale.payment_method?.toUpperCase()}
                </div>
              </div>
              
              <div className="my-3 border-t-2 border-dashed border-gray-400" />
              
              <div className="text-center text-xs space-y-1">
                <div className="font-semibold">THANK YOU FOR SHOPPING!</div>
                <div>Visit us again for more great deals</div>
                <div>🌟 Rate us on Google & Get 5% off next purchase</div>
                <div className="mt-2">
                  <div>Return Policy: 7 days with receipt</div>
                  <div>Customer Care: 1800-XXX-XXXX</div>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}