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
  buildInvoice, fetchStoreDetails, getMyLocationId, makeLine, printReceipt,
  DEFAULT_STORE, type Invoice, type InvoiceLine, type StoreDetails,
} from "@/lib/invoice";
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
  hsn_code?: string | null;
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
  const [storeDetails, setStoreDetails] = useState<StoreDetails>(DEFAULT_STORE);
  const [lastInvoice, setLastInvoice] = useState<Invoice | null>(null);

  useEffect(() => {
    fetchData();
    fetchPaymentSettings();
  }, []);

  useEffect(() => {
    if (!user) return;
    getMyLocationId(user.id)
      .then(fetchStoreDetails)
      .then(setStoreDetails)
      .catch(() => setStoreDetails(DEFAULT_STORE));
  }, [user]);

  // Build the printable bill from what was actually saved
  const buildLastInvoice = async (sale: any, items: CartItem[]): Promise<Invoice> => {
    let lines: InvoiceLine[] = items.map(item => makeLine({
      name: item.product.name,
      hsn: item.product.hsn_code,
      quantity: item.quantity,
      rate: item.product.price,
      discountPercent: item.discount,
      gstRate: item.product.gst_rate,
    }));
    let customerName: string | null = null;
    let customerGstin: string | null = null;
    let store = storeDetails;
    try {
      const [savedItems, customerRes, saleStore] = await Promise.all([
        supabase.from('sale_items').select('*').eq('sale_id', sale.id),
        sale.customer_id
          ? supabase.from('customers').select('*').eq('id', sale.customer_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        sale.location_id ? fetchStoreDetails(sale.location_id) : Promise.resolve(storeDetails),
      ]);
      store = saleStore;
      const c = customerRes.data as Record<string, any> | null;
      customerName = c?.name || null;
      customerGstin = c?.gstin || null;
      const rows = (savedItems.data || []) as Record<string, any>[];
      if (rows.length === items.length) {
        lines = rows.map(row => {
          const item = items.find(i => i.product.id === row.product_id);
          const gstAmount = Number(row.gst_amount || 0);
          const total = Number(row.total_price || 0);
          const taxable = Math.round((total - gstAmount) * 100) / 100;
          return {
            name: item?.product.name || 'Item',
            hsn: row.hsn_code ?? item?.product.hsn_code ?? null,
            quantity: Number(row.quantity),
            rate: Number(row.unit_price),
            discountPercent: Number(row.discount_percent ?? item?.discount ?? 0),
            taxable,
            gstRate: Number(row.gst_rate ?? item?.product.gst_rate ?? 0),
            gstAmount,
            total,
          };
        });
      }
    } catch (e) {
      console.warn('Could not load saved bill details, using cart values', e);
    }
    return buildInvoice({
      store,
      invoiceNumber: sale.invoice_number,
      createdAt: sale.created_at,
      paymentMethod: sale.payment_method,
      customerName,
      customerGstin,
      interstate: !!sale.is_interstate,
      lines,
      total: Number(sale.total_amount),
    });
  };

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

      const saved = await processSale(customerId);
      if (saved) setShowCustomerDialog(false);
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

  // Old way of saving (separate steps from the browser). Only used if the
  // database does not have the create_sale function yet.
  const legacySaveSale = async (customerId: string | null) => {
    const { subtotal, totalGST, total } = getCartTotals();
    const invoiceNumber = `INV-${Date.now()}`;

    const { data: sale, error: saleError } = await supabase
      .from('sales')
      .insert({
        customer_id: customerId,
        cashier_id: user!.id,
        total_amount: total,
        tax_amount: totalGST,
        invoice_number: invoiceNumber,
        payment_method: paymentMethod
      })
      .select()
      .single();

    if (saleError) throw saleError;

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

    for (const item of cart) {
      const newStock = (item.product.stock_quantity || 0) - item.quantity;
      await supabase
        .from('products')
        .update({ stock_quantity: Math.max(0, newStock) })
        .eq('id', item.product.id);
    }

    return sale;
  };

  const processSale = async (customerId?: string | null): Promise<boolean> => {
    if (!user) return false;

    try {
      const customer = customerId || selectedCustomer || null;

      // Save bill + items + stock in one database step
      const { data: savedSale, error: rpcError } = await supabase.rpc('create_sale', {
        p_items: cart.map(item => ({
          product_id: item.product.id,
          quantity: item.quantity,
          discount: item.discount || 0
        })),
        p_customer_id: customer,
        p_payment_method: paymentMethod
      });

      let sale = savedSale;
      if (rpcError) {
        // Function not installed yet: keep the shop running the old way
        const missing = rpcError.code === 'PGRST202' || rpcError.code === '42883';
        if (!missing) throw rpcError;
        console.warn('create_sale not found in database, using old save method');
        sale = await legacySaveSale(customer);
      }
      const invoiceNumber = sale.invoice_number;

      // Note: Loyalty points feature removed as per business requirements

      toast({
        title: "Sale Completed",
        description: `Invoice ${invoiceNumber} generated successfully`
      });

      // Store last sale for printing/sharing
      const soldItems = cart;
      setLastSale(sale);
      setLastSaleItems(soldItems);
      setLastInvoice(null);
      buildLastInvoice(sale, soldItems).then(setLastInvoice);

      // Reset cart and form
      setCart([]);
      setSelectedCustomer("");
      setPaymentMethod("cash");
      fetchData(); // Refresh product data
      fetchPaymentSettings(); // Refresh payment settings
      return true;
    } catch (error: any) {
      toast({
        title: "Sale not saved",
        description: error?.message || "Failed to process sale",
        variant: "destructive"
      });
      fetchData(); // Refresh stock so the cashier sees what is left
      return false;
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
                      invoice_number: 'Draft',
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
                <Button className="flex-1" disabled={!lastInvoice} onClick={() => {
                  if (lastInvoice && !printReceipt(lastInvoice)) {
                    toast({ title: "Pop-up blocked", description: "Allow pop-ups for this site to print bills", variant: "destructive" });
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
                      unit_price: calculateItemTotal(item) / item.quantity,
                      total_price: calculateItemTotal(item)
                    })),
                    subtotal: lastInvoice?.taxable ?? 0,
                    tax_amount: lastInvoice?.totalTax ?? Number(lastSale.tax_amount || 0),
                    total_amount: Number(lastSale.total_amount),
                    payment_method: lastSale.payment_method,
                    invoice_number: lastSale.invoice_number,
                    created_at: lastSale.created_at,
                    invoice: lastInvoice
                  }}
                  recipientPhone=""
                  recipientName={lastInvoice?.customerName || ""}
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

      </div>
    </div>
  );
}