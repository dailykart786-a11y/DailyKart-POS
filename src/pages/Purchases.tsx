import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useStore, inStore } from "@/hooks/useStore";
import { toast } from "@/hooks/use-toast";
import { isValidGstin } from "@/lib/invoice";
import { Truck, Plus, Trash2, Save, IndianRupee, BookOpen } from "lucide-react";
import { SupplierLedgerCard } from "@/components/SupplierLedgerCard";
import { dueInfo } from "@/lib/statement";
import { Badge } from "@/components/ui/badge";

interface Product { id: string; name: string; sku: string; barcode: string | null; cost_price: number; gst_rate: number | null; stock_quantity: number | null; }
interface Supplier {
  supplier_id: string; name: string; phone: string | null; gstin: string | null; purchase_total: number; paid_total: number; balance: number;
  location_id?: string; opening_balance?: number; credit_days?: number | null; oldest_due_at?: string | null;
}
interface Line { product: Product; quantity: string; unitCost: string; gstRate: string; batchNo?: string; expiry?: string; }
interface PurchaseRow { id: string; bill_number: string | null; bill_date: string; total_amount: number; tax_amount: number; suppliers?: { name: string } | null; }

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

export default function Purchases() {
  const { filterStoreId, newRecordFields } = useStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);

  // new purchase form
  const [supplierId, setSupplierId] = useState("");
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState("");
  const [paidNow, setPaidNow] = useState("");
  const [paidMethod, setPaidMethod] = useState("cash");

  // supplier form
  const [sName, setSName] = useState("");
  const [sPhone, setSPhone] = useState("");
  const [sGstin, setSGstin] = useState("");
  const [payFor, setPayFor] = useState<Supplier | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");
  const [ledgerFor, setLedgerFor] = useState<Supplier | null>(null);

  const load = async () => {
    const [pRes, sRes, puRes] = await Promise.all([
      inStore(supabase.from("products").select("id, name, sku, barcode, cost_price, gst_rate, stock_quantity").eq("is_active", true), filterStoreId).order("name"),
      inStore(supabase.from("supplier_balances" as any).select("*"), filterStoreId).order("name"),
      inStore(supabase.from("purchases" as any).select("id, bill_number, bill_date, total_amount, tax_amount, suppliers(name)"), filterStoreId)
        .order("created_at", { ascending: false }).limit(30),
    ]);
    if (sRes.error && /supplier_balances/.test(sRes.error.message || "") || sRes.error?.code === "PGRST205") {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    setProducts((pRes.data || []) as any);
    setSuppliers(((sRes.data || []) as any[]).map((s) => ({ ...s, purchase_total: Number(s.purchase_total), paid_total: Number(s.paid_total), balance: Number(s.balance), opening_balance: Number(s.opening_balance || 0) })));
    setPurchases(((puRes.data || []) as any[]).map((p) => ({ ...p, total_amount: Number(p.total_amount), tax_amount: Number(p.tax_amount) })));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStoreId]);

  const addLine = (term: string) => {
    const t = term.trim().toLowerCase();
    if (!t) return;
    const p = products.find((x) => (x.barcode || "").toLowerCase() === t)
      || products.find((x) => x.sku.toLowerCase() === t)
      || products.find((x) => x.name.toLowerCase() === t)
      || (products.filter((x) => x.name.toLowerCase().includes(t)).length === 1 ? products.find((x) => x.name.toLowerCase().includes(t)) : undefined);
    if (!p) {
      toast({ title: "Product not found", description: "Pick from the list, scan its barcode, or add it on the Products page first", variant: "destructive" });
      return;
    }
    setLines((ls) => ls.some((l) => l.product.id === p.id)
      ? ls.map((l) => l.product.id === p.id ? { ...l, quantity: String((parseFloat(l.quantity) || 0) + 1) } : l)
      : [...ls, { product: p, quantity: "1", unitCost: String(p.cost_price ?? ""), gstRate: String(p.gst_rate ?? 0) }]);
    setPick("");
  };

  const setLine = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => l.product.id === id ? { ...l, ...patch } : l));

  const totals = useMemo(() => {
    let taxable = 0, tax = 0;
    for (const l of lines) {
      const t = r2((parseFloat(l.unitCost) || 0) * (parseFloat(l.quantity) || 0));
      taxable += t;
      tax += r2(t * (parseFloat(l.gstRate) || 0) / 100);
    }
    return { taxable: r2(taxable), tax: r2(tax), total: r2(taxable + tax) };
  }, [lines]);

  const savePurchase = async () => {
    if (!supplierId) { toast({ title: "Pick the supplier", variant: "destructive" }); return; }
    if (!lines.length) { toast({ title: "Add at least one item", variant: "destructive" }); return; }
    if (lines.some((l) => !(parseFloat(l.quantity) > 0))) { toast({ title: "Every item needs a quantity", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("create_purchase" as any, {
        p_supplier_id: supplierId,
        p_items: lines.map((l) => ({ product_id: l.product.id, quantity: parseFloat(l.quantity), unit_cost: parseFloat(l.unitCost) || 0, gst_rate: parseFloat(l.gstRate) || 0 })),
        p_bill_number: billNo.trim() || null,
        p_bill_date: billDate || null,
        p_paid_amount: parseFloat(paidNow) || 0,
        p_paid_method: paidMethod,
      } as any);
      if (error) throw error;
      toast({ title: "Purchase saved", description: `Stock added. Bill total ${rupees(Number((data as any).total_amount))}` });
      // Batch numbers / expiry dates (optional, saved after the bill)
      const batches = lines
        .filter((l) => (l.batchNo || "").trim() || l.expiry)
        .map((l) => ({
          product_id: l.product.id,
          batch_no: (l.batchNo || "").trim() || null,
          expiry_date: l.expiry || null,
          quantity: Math.round(parseFloat(l.quantity) || 0),
          purchase_id: (data as any)?.id || null,
        }))
        .filter((b) => b.quantity > 0);
      if (batches.length) {
        const { error: bErr } = await supabase.from("product_batches" as any).insert(batches as any);
        if (bErr) {
          toast({
            title: "Batch / expiry not saved",
            description: bErr.code === "PGRST205" || /product_batches/.test(bErr.message || "")
              ? "This needs the latest database update (dailykart-updates.sql). The purchase itself is saved."
              : bErr.message,
            variant: "destructive",
          });
        }
      }
      setLines([]); setBillNo(""); setPaidNow("");
      load();
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message || "Failed to save purchase", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const addSupplier = async () => {
    const name = sName.trim();
    if (!name) return;
    const gstin = sGstin.trim().toUpperCase();
    if (gstin && !isValidGstin(gstin)) { toast({ title: "Check GSTIN", description: "GSTIN should be 15 characters", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.from("suppliers").insert({ name, phone: sPhone.trim() || null, gstin: gstin || null, state_code: gstin ? gstin.slice(0, 2) : null, ...newRecordFields } as any).select().single();
      if (error) throw error;
      setSName(""); setSPhone(""); setSGstin("");
      await load();
      setSupplierId((data as any).id);
      toast({ title: "Supplier added", description: name });
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message || "Failed to add supplier", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const paySupplier = async () => {
    if (!payFor) return;
    const amt = r2(parseFloat(payAmount) || 0);
    if (amt <= 0) { toast({ title: "Enter the amount paid", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from("supplier_payments" as any).insert({ supplier_id: payFor.supplier_id, amount: amt, method: payMethod } as any);
      if (error) throw error;
      toast({ title: "Payment saved", description: `${rupees(amt)} paid to ${payFor.name}` });
      setPayFor(null); setPayAmount("");
      load();
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message || "Failed to save payment", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const totalOwed = suppliers.reduce((s, x) => s + Math.max(0, x.balance), 0);

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Truck className="h-6 w-6" /> Purchases</h1>
          <p className="text-muted-foreground">Enter supplier bills to add stock, and track what you owe suppliers</p>
        </div>

        {unavailable ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">
            Purchases need a database update. Ask your admin to run the latest dailykart-updates.sql in Supabase.
          </CardContent></Card>
        ) : (
          <Tabs defaultValue="new">
            <TabsList>
              <TabsTrigger value="new">New purchase</TabsTrigger>
              <TabsTrigger value="list">Purchase bills</TabsTrigger>
              <TabsTrigger value="suppliers">Suppliers{totalOwed > 0 ? ` (${rupees(totalOwed)} due)` : ""}</TabsTrigger>
            </TabsList>

            <TabsContent value="new" className="space-y-4">
              <Card>
                <CardContent className="p-4 grid gap-3 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Supplier</Label>
                    <Select value={supplierId} onValueChange={setSupplierId}>
                      <SelectTrigger><SelectValue placeholder={suppliers.length ? "Pick supplier" : "Add a supplier first"} /></SelectTrigger>
                      <SelectContent>
                        {suppliers.map((s) => <SelectItem key={s.supplier_id} value={s.supplier_id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pb-no">Supplier bill no.</Label>
                    <Input id="pb-no" value={billNo} onChange={(e) => setBillNo(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pb-date">Bill date</Label>
                    <Input id="pb-date" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-lg">Items</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Input list="purchase-products" placeholder="Scan barcode or type product name, then Enter" value={pick}
                      onChange={(e) => setPick(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLine(pick); } }} />
                    <datalist id="purchase-products">
                      {products.map((p) => <option key={p.id} value={p.name}>{p.sku}</option>)}
                    </datalist>
                    <Button type="button" variant="outline" onClick={() => addLine(pick)} className="gap-1 shrink-0"><Plus className="h-4 w-4" /> Add</Button>
                  </div>
                  {lines.length > 0 && (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Product</TableHead>
                            <TableHead className="w-24">Qty</TableHead>
                            <TableHead className="w-28">Cost / unit (before GST)</TableHead>
                            <TableHead className="w-20">GST %</TableHead>
                            <TableHead className="w-28">Batch (optional)</TableHead>
                            <TableHead className="w-36">Expiry (optional)</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {lines.map((l) => {
                            const t = r2((parseFloat(l.unitCost) || 0) * (parseFloat(l.quantity) || 0));
                            return (
                              <TableRow key={l.product.id}>
                                <TableCell>
                                  <div className="font-medium">{l.product.name}</div>
                                  <div className="text-xs text-muted-foreground">In stock: {l.product.stock_quantity ?? 0}</div>
                                </TableCell>
                                <TableCell><Input type="number" min="0" step="any" aria-label={`Quantity of ${l.product.name}`} value={l.quantity} onChange={(e) => setLine(l.product.id, { quantity: e.target.value })} /></TableCell>
                                <TableCell><Input type="number" min="0" step="0.01" aria-label={`Cost of ${l.product.name}`} value={l.unitCost} onChange={(e) => setLine(l.product.id, { unitCost: e.target.value })} /></TableCell>
                                <TableCell><Input type="number" min="0" step="0.01" aria-label={`GST of ${l.product.name}`} value={l.gstRate} onChange={(e) => setLine(l.product.id, { gstRate: e.target.value })} /></TableCell>
                                <TableCell><Input aria-label={`Batch of ${l.product.name}`} value={l.batchNo || ""} onChange={(e) => setLine(l.product.id, { batchNo: e.target.value })} /></TableCell>
                                <TableCell><Input type="date" aria-label={`Expiry of ${l.product.name}`} value={l.expiry || ""} onChange={(e) => setLine(l.product.id, { expiry: e.target.value })} /></TableCell>
                                <TableCell className="text-right">{rupees(t + r2(t * (parseFloat(l.gstRate) || 0) / 100))}</TableCell>
                                <TableCell>
                                  <Button size="icon" variant="ghost" aria-label={`Remove ${l.product.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.product.id !== l.product.id))}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end border-t pt-4">
                    <div className="text-sm space-y-1">
                      <div className="flex justify-between"><span>Taxable</span><span>{rupees(totals.taxable)}</span></div>
                      <div className="flex justify-between"><span>Input GST</span><span>{rupees(totals.tax)}</span></div>
                      <div className="flex justify-between font-bold text-base"><span>Bill total</span><span>{rupees(totals.total)}</span></div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-2">
                        <Label htmlFor="pb-paid">Paid now</Label>
                        <Input id="pb-paid" type="number" min="0" step="0.01" placeholder="0" value={paidNow} onChange={(e) => setPaidNow(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>By</Label>
                        <Select value={paidMethod} onValueChange={setPaidMethod}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cash">Cash</SelectItem>
                            <SelectItem value="upi">UPI</SelectItem>
                            <SelectItem value="bank">Bank</SelectItem>
                            <SelectItem value="cheque">Cheque</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button onClick={savePurchase} disabled={busy} className="gap-2"><Save className="h-4 w-4" /> {busy ? "Saving..." : "Save purchase"}</Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="list">
              <Card>
                <CardContent className="p-4 overflow-x-auto">
                  {purchases.length === 0 ? <p className="text-center text-muted-foreground py-4">No purchases yet</p> : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Supplier</TableHead>
                          <TableHead>Bill no.</TableHead>
                          <TableHead className="text-right">GST</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {purchases.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell>{new Date(p.bill_date).toLocaleDateString("en-IN")}</TableCell>
                            <TableCell>{p.suppliers?.name || "-"}</TableCell>
                            <TableCell>{p.bill_number || "-"}</TableCell>
                            <TableCell className="text-right">{rupees(p.tax_amount)}</TableCell>
                            <TableCell className="text-right font-medium">{rupees(p.total_amount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="suppliers" className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-lg">Add supplier</CardTitle></CardHeader>
                <CardContent className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                  <Input placeholder="Name" value={sName} onChange={(e) => setSName(e.target.value)} />
                  <Input placeholder="Phone" value={sPhone} onChange={(e) => setSPhone(e.target.value)} />
                  <Input placeholder="GSTIN (optional)" maxLength={15} value={sGstin} onChange={(e) => setSGstin(e.target.value.toUpperCase())} />
                  <Button onClick={addSupplier} disabled={busy || !sName.trim()} className="gap-1"><Plus className="h-4 w-4" /> Add</Button>
                </CardContent>
              </Card>
              {ledgerFor && (
                <SupplierLedgerCard
                  supplier={suppliers.find((x) => x.supplier_id === ledgerFor.supplier_id) || ledgerFor}
                  onClose={() => setLedgerFor(null)}
                  onChanged={load}
                />
              )}
              {payFor && (
                <Card>
                  <CardHeader><CardTitle className="text-lg">Pay {payFor.name} (due {rupees(payFor.balance)})</CardTitle></CardHeader>
                  <CardContent className="grid gap-2 sm:grid-cols-[1fr_160px_auto_auto]">
                    <Input type="number" min="0" step="0.01" aria-label="Amount paid" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
                    <Select value={payMethod} onValueChange={setPayMethod}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="upi">UPI</SelectItem>
                        <SelectItem value="bank">Bank</SelectItem>
                        <SelectItem value="cheque">Cheque</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button onClick={paySupplier} disabled={busy} className="gap-1"><IndianRupee className="h-4 w-4" /> Save payment</Button>
                    <Button variant="outline" onClick={() => setPayFor(null)}>Cancel</Button>
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardContent className="p-4 overflow-x-auto">
                  {suppliers.length === 0 ? <p className="text-center text-muted-foreground py-4">No suppliers yet</p> : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Supplier</TableHead>
                          <TableHead className="text-right hidden sm:table-cell">Bought</TableHead>
                          <TableHead className="text-right hidden sm:table-cell">Paid</TableHead>
                          <TableHead className="text-right">You owe</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {suppliers.map((s) => (
                          <TableRow key={s.supplier_id}>
                            <TableCell>
                              <div className="font-medium">{s.name}</div>
                              <div className="text-xs text-muted-foreground">{[s.phone, s.gstin].filter(Boolean).join(" · ") || "-"}</div>
                            </TableCell>
                            <TableCell className="text-right hidden sm:table-cell">{rupees(s.purchase_total)}</TableCell>
                            <TableCell className="text-right hidden sm:table-cell">{rupees(s.paid_total)}</TableCell>
                            <TableCell className={`text-right font-semibold ${s.balance > 0 ? "text-destructive" : ""}`}>
                              {rupees(s.balance)}
                              {(() => {
                                const d = s.balance > 0 ? dueInfo(s.oldest_due_at, s.credit_days) : null;
                                if (!d) return null;
                                return <div className="text-xs font-normal">{d.overdueDays > 0 ? <Badge variant="destructive">{d.overdueDays}d overdue</Badge> : `due ${d.due.toLocaleDateString("en-IN")}`}</div>;
                              })()}
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap space-x-1">
                              <Button size="sm" variant="ghost" aria-label={`Ledger for ${s.name}`} onClick={() => setLedgerFor(s)}><BookOpen className="h-4 w-4" /></Button>
                              <Button size="sm" variant="outline" onClick={() => { setPayFor(s); setPayAmount(s.balance > 0 ? String(s.balance) : ""); }}>Pay</Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </Layout>
  );
}
