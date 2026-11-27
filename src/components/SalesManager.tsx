import { useState, useEffect, useRef } from "react";
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
import { Plus, Minus, Search, ShoppingCart, CreditCard, Smartphone, Trash2, Calculator, ScanLine } from "lucide-react";
import { BarcodeScannerDialog } from "@/components/BarcodeScannerDialog";
import { PauseCircle, PlayCircle } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const HELD_KEY = "dailykart-held-bills";
interface HeldBill { id: string; at: string; items: { productId: string; quantity: number; discount: number }[]; customerId: string; label: string; }
const readHeld = (): HeldBill[] => { try { return JSON.parse(localStorage.getItem(HELD_KEY) || "[]"); } catch { return []; } };
const writeHeld = (bills: HeldBill[]) => { try { localStorage.setItem(HELD_KEY, JSON.stringify(bills)); } catch { /* storage off */ } };
const SPLIT_KEYS = ["cash", "upi", "card", "credit"] as const;
type SplitKey = typeof SPLIT_KEYS[number];
import { QRCodeSVG } from "qrcode.react";
import { useStore, inStore } from "@/hooks/useStore";
import {
  QueuedSale, addToQueue, cacheGet, cacheSet, isNetworkError, isOffline, newClientRef, offlineBillNumber,
} from "@/lib/offline";
import { Batch, estimateLeft, todayIso } from "@/lib/batches";
import { Offer, bestOffer, maxPointsForBill, pointsPercent, stackDiscount } from "@/lib/offers";
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
  barcode?: string | null;
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
  /** Set when the discount came from an offer */
  offerName?: string;
}

interface LoyaltyInfo { balance: number; pointValue: number; minRedeem: number; }

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
  const { isAdmin, workingStoreId, newRecordFields } = useStore();
  // Admins bill for the selected store (or their own store when "All stores" is picked)
  const billingStoreFilter = isAdmin ? workingStoreId : null;
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
  const [scannerOpen, setScannerOpen] = useState(false);
  const [split, setSplit] = useState<Record<SplitKey, string>>({ cash: "", upi: "", card: "", credit: "" });
  const [heldBills, setHeldBills] = useState<HeldBill[]>(() => readHeld());
  const searchRef = useRef<HTMLInputElement>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loyalty, setLoyalty] = useState<LoyaltyInfo | null>(null);
  const [usePoints, setUsePoints] = useState(0);
  const [pointsInput, setPointsInput] = useState("");

  // Offers for this store (optional: needs the database update)
  useEffect(() => {
    let cancelled = false;
    inStore(supabase.from('offers' as any).select('*').eq('is_active', true), billingStoreFilter)
      .then(({ data, error }: any) => { if (!cancelled && !error) setOffers(((data || []) as any[]).map(o => ({ ...o, percent: Number(o.percent) }))); }, () => undefined);
    return () => { cancelled = true; };
  }, [billingStoreFilter]);

  // Loyalty points of the chosen customer
  useEffect(() => {
    setUsePoints(0);
    setPointsInput("");
    setLoyalty(null);
    if (!selectedCustomer) return;
    let cancelled = false;
    supabase.from('customer_loyalty' as any).select('*').eq('customer_id', selectedCustomer).maybeSingle()
      .then(({ data, error }: any) => {
        if (cancelled || error || !data || !data.loyalty_enabled) return;
        setLoyalty({ balance: Number(data.balance) || 0, pointValue: Number(data.loyalty_point_value) || 0, minRedeem: Number(data.loyalty_min_redeem) || 0 });
      }, () => undefined);
    return () => { cancelled = true; };
  }, [selectedCustomer]);

  useEffect(() => {
    fetchData();
    fetchPaymentSettings();
  }, [billingStoreFilter]);

  useEffect(() => {
    if (!user) return;
    getMyLocationId(user.id)
      .then(fetchStoreDetails)
      .then((d) => { setStoreDetails(d); cacheSet('store', user.id, d); })
      .catch(() => setStoreDetails(cacheGet<StoreDetails>('store', user.id) || DEFAULT_STORE));
  }, [user]);

  // Build the printable bill from what was actually saved
  const buildLastInvoice = async (sale: any, items: CartItem[]): Promise<Invoice> => {
    let lines: InvoiceLine[] = items.map(item => makeLine({
      name: item.product.name,
      hsn: item.product.hsn_code,
      quantity: item.quantity,
      rate: item.product.price,
      discountPercent: lineDiscount(item),
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
      paymentMethod: sale.payment_split
        ? Object.entries(sale.payment_split as Record<string, number>)
            .map(([k, v]) => `${k === 'credit' ? 'udhaar' : k} ${Number(v).toFixed(2)}`).join(' + ')
        : sale.payment_method,
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
        inStore(supabase.from('products').select('*').eq('is_active', true), billingStoreFilter),
        inStore(supabase.from('customers').select('*'), billingStoreFilter)
      ]);

      if (productsRes.error) throw productsRes.error;
      if (customersRes.error) throw customersRes.error;

      setProducts(productsRes.data || []);
      setCustomers(customersRes.data || []);
      if (user) {
        cacheSet('products', user.id, productsRes.data || []);
        cacheSet('customers', user.id, customersRes.data || []);
      }
    } catch (error) {
      // No internet: use the lists saved on this device last time
      const saved = user && isNetworkError(error) ? cacheGet<Product[]>('products', user.id) : null;
      if (saved) {
        setProducts(saved);
        setCustomers(cacheGet<Customer[]>('customers', user!.id) || []);
        return;
      }
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

  // Products that probably still have expired pieces on the shelf
  const [expiredStock, setExpiredStock] = useState<Record<string, string>>({});
  const warnedExpired = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!products.length) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await inStore(
          supabase.from('product_batches' as any).select('id, product_id, batch_no, expiry_date, quantity, created_at, cleared_at').is('cleared_at', null),
          billingStoreFilter,
        ).limit(2000);
        if (error || cancelled) return;
        const today = todayIso();
        const by: Record<string, Batch[]> = {};
        for (const b of (data || []) as any[]) (by[b.product_id] ||= []).push({ ...b, quantity: Number(b.quantity) });
        const out: Record<string, string> = {};
        for (const p of products) {
          const list = by[p.id];
          if (!list) continue;
          const old = estimateLeft(list, p.stock_quantity ?? 0).find(b => b.left > 0 && b.expiry_date && b.expiry_date < today);
          if (old) out[p.id] = old.expiry_date!;
        }
        setExpiredStock(out);
      } catch { /* expiry warnings are optional */ }
    })();
    return () => { cancelled = true; };
  }, [products, billingStoreFilter]);

  const addToCart = (product: Product) => {
    if (expiredStock[product.id] && !warnedExpired.current.has(product.id)) {
      warnedExpired.current.add(product.id);
      toast({ title: "Check the expiry date", description: `Some ${product.name} expired on ${expiredStock[product.id]}. Give the customer a fresh one.` });
    }
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      const nextQty = (existing?.quantity || 0) + 1;
      const stock = product.stock_quantity ?? 0;
      if (nextQty > stock) {
        toast({
          title: "Not enough stock",
          description: `${product.name}: only ${stock} left`,
          variant: "destructive"
        });
        return prev;
      }
      return existing
        ? prev.map(item => item.product.id === product.id ? withOffer({ ...item, quantity: nextQty }) : item)
        : [...prev, withOffer({ product, quantity: 1, discount: 0 })];
    });
  };

  // Find a product by exact barcode or SKU (what a scanner types)
  const findByCode = (code: string) => {
    const c = code.trim().toLowerCase();
    if (!c) return undefined;
    return products.find(p => (p.barcode || '').trim().toLowerCase() === c)
      || products.find(p => p.sku.trim().toLowerCase() === c);
  };

  const addByCode = (code: string) => {
    const product = findByCode(code);
    if (product) {
      addToCart(product);
      return true;
    }
    toast({ title: "Not found", description: `No product with barcode ${code}`, variant: "destructive" });
    return false;
  };

  // Puts the best live offer on a line, unless the cashier typed their own discount
  const withOffer = (item: CartItem): CartItem => {
    if (item.discount > 0 && !item.offerName) return item;
    const o = offers.length ? bestOffer(item.product, item.quantity, offers, todayIso()) : null;
    return o ? { ...item, discount: Number(o.percent), offerName: o.name } : { ...item, discount: item.offerName ? 0 : item.discount, offerName: undefined };
  };

  const updateCartQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    
    setCart(cart.map(item =>
      item.product.id === productId
        ? withOffer({ ...item, quantity })
        : item
    ));
  };

  const updateCartDiscount = (productId: string, discount: number) => {
    setCart(cart.map(item =>
      item.product.id === productId
        ? { ...item, discount: Math.max(0, Math.min(100, discount || 0)), offerName: undefined }
        : item
    ));
  };

  const removeFromCart = (productId: string) => {
    setCart(cart.filter(item => item.product.id !== productId));
  };

  // Bill before loyalty points, then the extra % off that the used points give
  const rawTotal = cart.reduce((sum, item) => {
    const after = item.product.price * item.quantity * (100 - item.discount) / 100;
    return sum + after + Math.round(after * (item.product.gst_rate || 0) / 100 * 100) / 100;
  }, 0);
  const pointsValue = loyalty && usePoints > 0 ? Math.round(usePoints * loyalty.pointValue * 100) / 100 : 0;
  const loyaltyPct = pointsPercent(pointsValue, rawTotal);
  /** Discount % sent to the database: the line's own discount plus points */
  const lineDiscount = (item: CartItem) => stackDiscount(item.discount, loyaltyPct);

  const calculateItemTotal = (item: CartItem) => {
    const baseTotal = item.product.price * item.quantity;
    const discountAmount = (baseTotal * lineDiscount(item)) / 100;
    const subtotalAfterDiscount = baseTotal - discountAmount;
    const gstAmount = calculateGST(item);
    return subtotalAfterDiscount + gstAmount;
  };

  const calculateGST = (item: CartItem) => {
    const basePrice = item.product.price * item.quantity;
    const discountAmount = (basePrice * lineDiscount(item)) / 100;
    const discountedPrice = basePrice - discountAmount;
    const gstRate = item.product.gst_rate || 0;
    return Math.round((discountedPrice * gstRate) / 100 * 100) / 100;
  };

  const getCartTotals = () => {
    const subtotalBeforeGST = cart.reduce((sum, item) => {
      const baseTotal = item.product.price * item.quantity;
      const discountAmount = (baseTotal * lineDiscount(item)) / 100;
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

  const splitSum = SPLIT_KEYS.reduce((sum, k) => sum + (parseFloat(split[k]) || 0), 0);
  const splitCredit = parseFloat(split.credit) || 0;
  const needsCustomer = paymentMethod === 'credit' || (paymentMethod === 'split' && splitCredit > 0);

  const holdBill = () => {
    if (!cart.length) return;
    const customerName = customers.find(c => c.id === selectedCustomer)?.name;
    const bill: HeldBill = {
      id: String(Date.now()),
      at: new Date().toISOString(),
      items: cart.map(i => ({ productId: i.product.id, quantity: i.quantity, discount: i.discount })),
      customerId: selectedCustomer,
      label: `${customerName || 'Walk-in'} · ${cart.length} item${cart.length > 1 ? 's' : ''} · ₹${getCartTotals().total.toLocaleString('en-IN')}`,
    };
    const next = [bill, ...readHeld()].slice(0, 20);
    writeHeld(next);
    setHeldBills(next);
    setCart([]);
    setSelectedCustomer("");
    toast({ title: "Bill on hold", description: "Serve the next customer. Resume it from Held bills." });
  };

  const resumeBill = (bill: HeldBill) => {
    if (cart.length) {
      toast({ title: "Finish or hold the current bill first", variant: "destructive" });
      return;
    }
    const items: CartItem[] = [];
    let missing = 0;
    for (const h of bill.items) {
      const product = products.find(p => p.id === h.productId);
      if (product) items.push({ product, quantity: h.quantity, discount: h.discount });
      else missing++;
    }
    setCart(items);
    setSelectedCustomer(bill.customerId || "");
    const next = readHeld().filter(b => b.id !== bill.id);
    writeHeld(next);
    setHeldBills(next);
    if (missing) toast({ title: "Some items were skipped", description: `${missing} item(s) are no longer for sale` });
  };

  const discardHeld = (bill: HeldBill) => {
    const next = readHeld().filter(b => b.id !== bill.id);
    writeHeld(next);
    setHeldBills(next);
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
    if (paymentMethod === 'split') {
      const { total } = getCartTotals();
      if (Math.abs(splitSum - total) > 0.05) {
        toast({ title: "Payments don't match the bill", description: `Entered ₹${splitSum.toFixed(2)}, bill is ₹${total.toFixed(2)}`, variant: "destructive" });
        return;
      }
    }
    if ((needsCustomer || usePoints > 0) && selectedCustomer) {
      // Known customer (udhaar or using points): no need to ask for details again
      processSale(selectedCustomer);
      return;
    }
    setShowCustomerDialog(true);
  };

  const handleCustomerSubmit = async (customerData: { name: string; phone: string; email: string; address: string }) => {
    setCustomerEntryLoading(true);
    
    try {
      let customerId = null;
      
      if (customerData.name.trim() && isOffline()) {
        // A new customer can't be added without internet
        if (needsCustomer) {
          throw new Error("No internet: udhaar needs a customer who is already saved. Pick them from the customer list.");
        }
        toast({ title: "No internet", description: "Bill saved without the new customer's details" });
        const saved = await processSale(null);
        if (saved) setShowCustomerDialog(false);
        return;
      }

      // Create customer if name is provided
      if (customerData.name.trim()) {
        const { data: customer, error: customerError } = await supabase
          .from('customers')
          .insert({
            name: customerData.name.trim(),
            phone: customerData.phone.trim() || null,
            email: customerData.email.trim() || null,
            address: customerData.address.trim() || null,
            ...newRecordFields
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

  // After a bill is saved (or kept offline): show it for printing and clear the till
  const finishSale = (sale: any, soldItems: CartItem[], refresh: boolean) => {
    setLastSale(sale);
    setLastSaleItems(soldItems);
    setLastInvoice(null);
    buildLastInvoice(sale, soldItems).then(setLastInvoice);

    setCart([]);
    setSelectedCustomer("");
    setPaymentMethod("cash");
    setSplit({ cash: "", upi: "", card: "", credit: "" });
    setUsePoints(0);
    setPointsInput("");
    if (refresh) {
      fetchData(); // Refresh product data
      fetchPaymentSettings(); // Refresh payment settings
    }
  };

  // No internet: keep the bill on this device; it is sent when back online
  const saveOffline = (saleArgs: Record<string, any>, payments: Record<string, number> | null, customer: string | null, uncertain: boolean): boolean => {
    if (!user) return false;
    if (usePoints > 0) {
      toast({ title: "Points can't be used without internet", description: "Remove the points and try again", variant: "destructive" });
      return false;
    }
    const ref = newClientRef();
    const { total } = getCartTotals();
    const soldAt = new Date().toISOString();
    const queued: QueuedSale = {
      client_ref: ref,
      sold_at: soldAt,
      cashier_id: user.id,
      items: saleArgs.p_items,
      lines: cart.map(i => ({ name: i.product.name, quantity: i.quantity })),
      customer_id: customer,
      payment_method: paymentMethod,
      payments: paymentMethod === 'split' ? payments : null,
      location_id: saleArgs.p_location_id || null,
      expected_total: total,
      uncertain,
      attempts: 0,
    };
    if (!addToQueue(queued)) {
      toast({ title: "Sale not saved", description: "No internet, and this device could not store the bill. Note it on paper.", variant: "destructive" });
      return false;
    }
    const sale = {
      id: ref,
      invoice_number: offlineBillNumber(ref),
      created_at: soldAt,
      total_amount: total,
      payment_method: paymentMethod,
      payment_split: paymentMethod === 'split' ? payments : null,
      customer_id: customer,
      location_id: saleArgs.p_location_id || null,
      is_interstate: false,
      offline: true,
    };
    // Take the sold items off the stock shown on this device
    const sold = new Map<string, number>();
    for (const i of cart) sold.set(i.product.id, (sold.get(i.product.id) || 0) + i.quantity);
    setProducts(ps => {
      const next = ps.map(p => sold.has(p.id) ? { ...p, stock_quantity: (p.stock_quantity || 0) - (sold.get(p.id) || 0) } : p);
      cacheSet('products', user.id, next);
      return next;
    });
    toast({
      title: uncertain ? "Connection lost: bill kept on this device" : "Saved offline",
      description: `${sale.invoice_number}. It gets its real bill number when the internet is back.`,
    });
    finishSale(sale, cart, false);
    return true;
  };

  const processSale = async (customerId?: string | null): Promise<boolean> => {
    if (!user) return false;

    const customer = customerId || selectedCustomer || null;

    // Save bill + items + stock in one database step
    const saleArgs: Record<string, any> = {
      p_items: cart.map(item => ({
        product_id: item.product.id,
        quantity: item.quantity,
        discount: lineDiscount(item) || 0
      })),
      p_customer_id: customer,
      p_payment_method: paymentMethod
    };
    if (billingStoreFilter) saleArgs.p_location_id = billingStoreFilter;

    let payments: Record<string, number> | null = null;
    if (paymentMethod === 'split') {
      payments = {};
      for (const k of SPLIT_KEYS) { const v = parseFloat(split[k]) || 0; if (v > 0) payments[k] = v; }
    }

    if (isOffline()) return saveOffline(saleArgs, payments, customer, false);

    let usedOldWay = false;
    try {
      let splitSale: any = null;
      if (paymentMethod === 'split') {
        const { p_payment_method, ...rest } = saleArgs;
        const { data, error } = await supabase.rpc('create_sale_split' as any, { ...rest, p_payments: payments } as any);
        if (error) {
          if (error.code === 'PGRST202') throw new Error('Split payment needs the latest database update. Use one payment method for now.');
          throw error;
        }
        splitSale = data;
      }

      let { data: savedSale, error: rpcError } = splitSale
        ? { data: splitSale, error: null as any }
        : await supabase.rpc('create_sale', saleArgs as any);
      if (rpcError && rpcError.code === 'PGRST202' && saleArgs.p_location_id) {
        // Database has the older create_sale without the store option
        const { p_location_id, ...older } = saleArgs;
        ({ data: savedSale, error: rpcError } = await supabase.rpc('create_sale', older as any));
      }

      let sale = savedSale;
      if (rpcError) {
        // Function not installed yet: keep the shop running the old way
        const missing = rpcError.code === 'PGRST202' || rpcError.code === '42883';
        if (!missing) throw rpcError;
        console.warn('create_sale not found in database, using old save method');
        usedOldWay = true;
        sale = await legacySaveSale(customer);
      }
      const invoiceNumber = sale.invoice_number;

      toast({
        title: "Sale Completed",
        description: `Invoice ${invoiceNumber} generated successfully`
      });

      if (usePoints > 0 && sale?.id && sale.customer_id) {
        const { error: pErr } = await supabase.rpc('redeem_loyalty_points' as any, { p_sale_id: sale.id, p_points: usePoints, p_value: pointsValue } as any);
        if (pErr) toast({ title: "Points not deducted", description: `${pErr.message}. The bill is saved with the discount.`, variant: "destructive" });
        else toast({ title: `${usePoints} points used`, description: `₹${pointsValue.toFixed(2)} off` });
      }

      finishSale(sale, cart, true);
      return true;
    } catch (error: any) {
      // The internet dropped while saving: keep the bill on this device.
      // (Not for the old way of saving, which may have saved part of it.)
      if (!usedOldWay && isNetworkError(error)) return saveOffline(saleArgs, payments, customer, true);
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
      product.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (product.barcode || '').toLowerCase().includes(searchTerm.toLowerCase());
    const productCategory = (product.category?.trim() || "Uncategorized");
    const matchesCategory = categoryFilter === "all" || productCategory === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const { subtotal, totalGST, total } = getCartTotals();
  const categories = Array.from(new Set(products.map(p => (p.category?.trim() || "Uncategorized"))));

  // UPI payment link - use settings from database or fallback
  const vpa = paymentSettings?.upi_vpa || "6302242108@kotak811";
  const payeeName = paymentSettings?.payee_name || "DailyKart";
  const upiAmount = (paymentMethod === 'split' ? (parseFloat(split.upi) || 0) : total).toFixed(2);
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
            <div className="flex gap-2">
              <Input
                ref={searchRef}
                autoFocus
                placeholder="Scan barcode or search by name / SKU"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  // USB scanners type the code and press Enter
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const term = searchTerm.trim();
                    if (!term) return;
                    if (findByCode(term)) {
                      addByCode(term);
                      setSearchTerm("");
                    } else if (filteredProducts.length === 1) {
                      addToCart(filteredProducts[0]);
                      setSearchTerm("");
                    }
                  }
                }}
                className="pl-10"
              />
              <Button type="button" variant="outline" onClick={() => setScannerOpen(true)} className="gap-2 shrink-0" aria-label="Scan with camera">
                <ScanLine className="h-4 w-4" />
                <span className="hidden sm:inline">Camera</span>
              </Button>
            </div>
          </div>
          <BarcodeScannerDialog
            open={scannerOpen}
            onOpenChange={(o) => { setScannerOpen(o); if (!o) setTimeout(() => searchRef.current?.focus(), 50); }}
            onDetected={addByCode}
          />
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
                  extraFields={newRecordFields}
                  onCustomerAdded={(newCustomer) => {
                    setCustomers(prev => [...prev, { ...newCustomer, loyalty_points: 0 }]);
                    setSelectedCustomer(newCustomer.id);
                  }} 
                />
              </div>
              {loyalty && (() => {
                const maxPts = maxPointsForBill(loyalty.balance, loyalty.pointValue, rawTotal);
                return (
                  <div className="rounded-md border p-2 text-sm space-y-2">
                    <div>
                      ⭐ <span className="font-medium">{loyalty.balance} points</span>{" "}
                      <span className="text-muted-foreground">(worth ₹{(loyalty.balance * loyalty.pointValue).toFixed(2)})</span>
                    </div>
                    {usePoints > 0 ? (
                      <div className="flex items-center justify-between gap-2">
                        <span>Using {usePoints} points: −₹{pointsValue.toFixed(2)}</span>
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => { setUsePoints(0); setPointsInput(""); }}>Remove</Button>
                      </div>
                    ) : loyalty.balance < loyalty.minRedeem ? (
                      <div className="text-xs text-muted-foreground">Points can be used from {loyalty.minRedeem} points</div>
                    ) : cart.length > 0 && maxPts > 0 ? (
                      <div className="flex gap-2">
                        <Input className="h-8" inputMode="numeric" aria-label="Points to use" placeholder={`Up to ${maxPts}`} value={pointsInput} onChange={(e) => setPointsInput(e.target.value)} />
                        <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => {
                          const n = pointsInput.trim() ? parseInt(pointsInput, 10) : maxPts;
                          if (!(n > 0)) return;
                          if (n > maxPts) { toast({ title: `Up to ${maxPts} points on this bill`, description: "Points can pay up to half the bill", variant: "destructive" }); return; }
                          if (n < loyalty.minRedeem && n < loyalty.balance) { toast({ title: `Use at least ${loyalty.minRedeem} points`, variant: "destructive" }); return; }
                          setUsePoints(n);
                        }}>Use points</Button>
                      </div>
                    ) : null}
                  </div>
                );
              })()}
            </div>
          </CardContent>
        </Card>

        {/* Cart Items */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                Cart Items
              </CardTitle>
              <div className="flex gap-2">
                {cart.length > 0 && (
                  <Button type="button" size="sm" variant="outline" className="gap-1" onClick={holdBill}>
                    <PauseCircle className="h-4 w-4" /> Hold
                  </Button>
                )}
                {heldBills.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="sm" variant="secondary" className="gap-1">
                        <PlayCircle className="h-4 w-4" /> Held ({heldBills.length})
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-72">
                      <DropdownMenuLabel>Bills on hold (this device)</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {heldBills.map(b => (
                        <div key={b.id} className="flex items-center gap-1 px-1">
                          <DropdownMenuItem className="flex-1 flex-col items-start" onSelect={() => resumeBill(b)}>
                            <span className="text-sm">{b.label}</span>
                            <span className="text-xs text-muted-foreground">{new Date(b.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                          </DropdownMenuItem>
                          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Discard held bill" onClick={() => discardHeld(b)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
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
                        {item.offerName && <Badge variant="secondary" className="ml-2">Offer: {item.offerName}</Badge>}
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
                {pointsValue > 0 && (
                  <div className="flex justify-between text-green-700">
                    <span>Points used ({usePoints}):</span>
                    <span>−₹{(Math.round((rawTotal - total) * 100) / 100).toLocaleString('en-IN')}</span>
                  </div>
                )}
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
                    <SelectItem value="credit">Credit (Udhaar)</SelectItem>
                    <SelectItem value="split">Split (part cash, part UPI...)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {paymentMethod === 'split' && (
                <div className="space-y-2 rounded-md border p-3">
                  <div className="grid grid-cols-2 gap-2">
                    {SPLIT_KEYS.map(k => (
                      <div key={k} className="space-y-1">
                        <Label htmlFor={`split-${k}`} className="text-xs">{k === 'credit' ? 'Udhaar' : k.toUpperCase()}</Label>
                        <Input id={`split-${k}`} type="number" inputMode="decimal" min="0" step="0.01" placeholder="0"
                          value={split[k]} onChange={(e) => setSplit(sp => ({ ...sp, [k]: e.target.value }))} />
                      </div>
                    ))}
                  </div>
                  {(() => {
                    const left = Math.round((total - splitSum) * 100) / 100;
                    return (
                      <div className="flex items-center justify-between text-sm">
                        <span className={Math.abs(left) <= 0.05 ? "text-green-600" : "text-destructive"}>
                          {Math.abs(left) <= 0.05 ? "Matches the bill" : left > 0 ? `₹${left.toFixed(2)} still to enter` : `₹${(-left).toFixed(2)} too much`}
                        </span>
                        {left > 0.05 && (
                          <Button type="button" size="sm" variant="ghost" onClick={() => setSplit(sp => ({ ...sp, cash: String(Math.round(((parseFloat(sp.cash) || 0) + left) * 100) / 100) }))}>
                            Rest in cash
                          </Button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              <div className="space-y-2">
                {(paymentMethod === 'upi' || (paymentMethod === 'split' && (parseFloat(split.upi) || 0) > 0)) && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setUpiDialogOpen(true)}
                  >
                    Show UPI QR to Pay (₹{(paymentMethod === 'split' ? parseFloat(split.upi) || 0 : total).toLocaleString('en-IN')})
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
          onSkip={async () => {
            if (needsCustomer) {
              toast({ title: "Customer needed", description: "Udhaar (credit) needs the customer's name so it shows in Khata", variant: "destructive" });
              return;
            }
            setCustomerEntryLoading(true);
            const saved = await processSale(null);
            setCustomerEntryLoading(false);
            if (saved) setShowCustomerDialog(false);
          }}
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
                <div className="font-medium">Amount: ₹{Number(upiAmount).toLocaleString('en-IN')}</div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

      </div>
    </div>
  );
}