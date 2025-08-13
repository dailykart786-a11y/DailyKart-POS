import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { Plus, ShoppingCart, Search, Trash2, Calculator } from "lucide-react";
import { WhatsAppIntegration } from "./WhatsAppIntegration";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
}

interface Customer {
  id: string;
  name: string;
  loyalty_points: number | null;
}

interface CartItem {
  product: Product;
  quantity: number;
  discount: number;
}

export function SalesManager() {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [upiDialogOpen, setUpiDialogOpen] = useState(false);
  const [lastSale, setLastSale] = useState<any | null>(null);
  const [lastSaleItems, setLastSaleItems] = useState<CartItem[]>([]);

  useEffect(() => {
    fetchData();
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

  const processSale = async () => {
    if (cart.length === 0) {
      toast({
        title: "Error",
        description: "Cart is empty",
        variant: "destructive"
      });
      return;
    }

    if (!user) return;

    try {
      const { subtotal, totalGST, total } = getCartTotals();
      const invoiceNumber = `INV-${Date.now()}`;

      // Create sale record
      const { data: sale, error: saleError } = await supabase
        .from('sales')
        .insert({
          customer_id: selectedCustomer || null,
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

  // UPI payment link
  const vpa = "6302242108@kotak811";
  const upiAmount = total.toFixed(2);
  const upiNote = lastSale?.invoice_number ? `Invoice ${lastSale.invoice_number}` : "POS Payment";
  const upiUrl = `upi://pay?pa=${encodeURIComponent(vpa)}&am=${encodeURIComponent(upiAmount)}&cu=INR&tn=${encodeURIComponent(upiNote)}`;

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
                    <div className="flex-1">
                      <p className="font-medium">{product.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {product.sku} • Stock: {product.stock_quantity || 0}
                      </p>
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
              <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
                <SelectTrigger>
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
                  onClick={processSale} 
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
                <Button className="flex-1" onClick={() => window.print()}>
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

        {/* UPI QR Dialog */}
        <Dialog open={upiDialogOpen} onOpenChange={setUpiDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Scan to Pay via UPI</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3">
              <QRCodeSVG value={upiUrl} size={200} includeMargin />
              <div className="text-sm text-muted-foreground">VPA: {vpa}</div>
              <div className="font-medium">Amount: ₹{total.toLocaleString('en-IN')}</div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Hidden print area for 80mm thermal receipt */}
        <div id="print-area" className="hidden">
          {lastSale && (
            <div className="mx-auto w-[80mm] p-3 text-sm">
              <div className="text-center">
                <div className="font-bold">DAILYKART POS</div>
                <div className="text-xs">Invoice: {lastSale.invoice_number}</div>
                <div className="text-xs">
                  {new Date(lastSale.created_at || Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                </div>
              </div>
              <div className="my-2 border-t border-dashed" />
              <div className="space-y-1">
                {lastSaleItems.map(item => (
                  <div key={item.product.id} className="flex justify-between">
                    <div>
                      <div>{item.product.name}</div>
                      <div className="text-xs text-muted-foreground">{item.quantity} × ₹{item.product.price.toLocaleString('en-IN')}</div>
                    </div>
                    <div>₹{calculateItemTotal(item).toLocaleString('en-IN')}</div>
                  </div>
                ))}
              </div>
              <div className="my-2 border-t border-dashed" />
              <div className="flex justify-between"><span>Subtotal</span><span>₹{subtotal.toLocaleString('en-IN')}</span></div>
              <div className="flex justify-between"><span>GST</span><span>₹{totalGST.toLocaleString('en-IN')}</span></div>
              <div className="flex justify-between font-semibold"><span>Total</span><span>₹{Number(lastSale.total_amount).toLocaleString('en-IN')}</span></div>
              <div className="text-center mt-3 text-xs">Paid via {lastSale.payment_method?.toUpperCase()}</div>
              <div className="text-center mt-3">Thank you! Visit again.</div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}