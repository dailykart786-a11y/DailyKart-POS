import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useStore, inStore } from "@/hooks/useStore";
import { toast } from "@/hooks/use-toast";
import { rupees } from "@/lib/statement";
import { whatsappLink } from "@/lib/dailySummary";
import { MessageCircle, PackageCheck, Plus, Save, Trash2, X } from "lucide-react";

export interface PoProduct { id: string; name: string; sku: string; barcode: string | null; cost_price: number; gst_rate: number | null; stock_quantity: number | null; }
export interface PoSupplier { supplier_id: string; name: string; phone: string | null; }

interface PoLine { product: PoProduct; quantity: string; unitCost: string; gstRate: string; }
interface PoRow {
  id: string; po_number: string; supplier_id: string; status: string; expected_date: string | null; note: string | null;
  total_amount: number; created_at: string; suppliers?: { name: string; phone: string | null } | null;
}
interface PoItem { id: string; product_id: string; quantity: number; unit_cost: number; gst_rate: number; received_qty: number; free_qty: number; damaged_qty: number; }
interface GrnLine { item: PoItem; product?: PoProduct; good: string; free: string; damaged: string; cost: string; gst: string; batch: string; expiry: string; }

const r2 = (n: number) => Math.round(n * 100) / 100;
const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  open: { label: "Ordered", variant: "outline" }, partial: { label: "Part received", variant: "default" },
  received: { label: "Received", variant: "secondary" }, cancelled: { label: "Cancelled", variant: "destructive" },
};

export function findProduct(products: PoProduct[], term: string): PoProduct | undefined {
  const t = term.trim().toLowerCase();
  if (!t) return undefined;
  const byName = products.filter((x) => x.name.toLowerCase().includes(t));
  return products.find((x) => (x.barcode || "").toLowerCase() === t)
    || products.find((x) => x.sku.toLowerCase() === t)
    || products.find((x) => x.name.toLowerCase() === t)
    || (byName.length === 1 ? byName[0] : undefined);
}

/** Purchase orders: order from a supplier, then receive what comes (all at once or in parts). */
export function PurchaseOrdersTab({ products, suppliers, onChanged }: { products: PoProduct[]; suppliers: PoSupplier[]; onChanged: () => void }) {
  const { filterStoreId } = useStore();
  const [available, setAvailable] = useState(true);
  const [orders, setOrders] = useState<PoRow[]>([]);
  const [busy, setBusy] = useState(false);
  // new order
  const [supplierId, setSupplierId] = useState("");
  const [expected, setExpected] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<PoLine[]>([]);
  const [pick, setPick] = useState("");
  // receiving
  const [receiving, setReceiving] = useState<PoRow | null>(null);
  const [grn, setGrn] = useState<GrnLine[]>([]);
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [paid, setPaid] = useState("");
  const [paidMethod, setPaidMethod] = useState("cash");

  const load = async () => {
    const { data, error } = await inStore(
      supabase.from("purchase_orders" as any).select("id, po_number, supplier_id, status, expected_date, note, total_amount, created_at, suppliers(name, phone)"),
      filterStoreId,
    ).order("created_at", { ascending: false }).limit(50);
    if (error) { setAvailable(false); return; }
    setAvailable(true);
    setOrders(((data || []) as any[]).map((o) => ({ ...o, total_amount: Number(o.total_amount) })));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStoreId]);

  if (!available) {
    return <Card><CardContent className="py-8 text-center text-muted-foreground">Purchase orders need the latest database update (dailykart-updates.sql).</CardContent></Card>;
  }

  const addLine = (p: PoProduct, qty = 1) => {
    setLines((ls) => ls.some((l) => l.product.id === p.id) ? ls
      : [...ls, { product: p, quantity: String(qty), unitCost: String(p.cost_price ?? ""), gstRate: String(p.gst_rate ?? 0) }]);
  };

  const addPick = () => {
    const p = findProduct(products, pick);
    if (!p) { toast({ title: "Product not found", description: "Pick from the list or scan its barcode", variant: "destructive" }); return; }
    addLine(p);
    setPick("");
  };

  const addLowStock = async () => {
    const { data, error } = await inStore(supabase.from("products").select("id, stock_quantity, min_stock_level").eq("is_active", true), filterStoreId);
    if (error) return;
    const low = ((data || []) as any[]).filter((p) => Number(p.stock_quantity || 0) <= Number(p.min_stock_level || 0));
    let added = 0;
    for (const row of low) {
      const p = products.find((x) => x.id === row.id);
      if (!p) continue;
      const want = Math.max(1, Number(row.min_stock_level || 0) * 2 - Number(row.stock_quantity || 0));
      addLine(p, want);
      added++;
    }
    toast({ title: added ? `${added} low-stock item${added === 1 ? "" : "s"} added` : "Nothing is low on stock" });
  };

  const total = r2(lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitCost) || 0) * (1 + (parseFloat(l.gstRate) || 0) / 100), 0));

  const poText = (po: { po_number: string; expected_date: string | null; note: string | null }, items: { name: string; qty: number }[]) => [
    `*Purchase order ${po.po_number}*`,
    "",
    ...items.map((i, n) => `${n + 1}. ${i.name} × ${i.qty}`),
    "",
    po.expected_date ? `Please deliver by ${new Date(`${po.expected_date}T12:00:00+05:30`).toLocaleDateString("en-IN")}` : "Please deliver at the earliest",
    po.note ? `Note: ${po.note}` : "",
  ].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");

  const saveOrder = async () => {
    if (!supplierId) { toast({ title: "Pick the supplier", variant: "destructive" }); return; }
    if (!lines.length) { toast({ title: "Add at least one item", variant: "destructive" }); return; }
    if (lines.some((l) => !(parseFloat(l.quantity) > 0))) { toast({ title: "Every item needs a quantity", variant: "destructive" }); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("create_purchase_order" as any, {
      p_supplier_id: supplierId,
      p_items: lines.map((l) => ({ product_id: l.product.id, quantity: parseFloat(l.quantity), unit_cost: parseFloat(l.unitCost) || 0, gst_rate: parseFloat(l.gstRate) || 0 })),
      p_expected_date: expected || null,
      p_note: note.trim() || null,
    } as any);
    setBusy(false);
    if (error) { toast({ title: "Order not saved", description: error.message, variant: "destructive" }); return; }
    const po = data as any;
    const sup = suppliers.find((s) => s.supplier_id === supplierId);
    toast({ title: `Order ${po.po_number} saved` });
    if (sup?.phone) window.open(whatsappLink(poText(po, lines.map((l) => ({ name: l.product.name, qty: parseFloat(l.quantity) }))), sup.phone), "_blank");
    setLines([]); setNote(""); setExpected("");
    load();
  };

  const sendAgain = async (po: PoRow) => {
    const { data } = await supabase.from("purchase_order_items" as any).select("product_id, quantity, received_qty").eq("po_id", po.id);
    const items = ((data || []) as any[]).map((i) => ({ name: products.find((p) => p.id === i.product_id)?.name || "Item", qty: Number(i.quantity) - Number(i.received_qty) }))
      .filter((i) => i.qty > 0);
    window.open(whatsappLink(poText(po, items), po.suppliers?.phone || ""), "_blank");
  };

  const cancel = async (po: PoRow) => {
    const { error } = await supabase.rpc("cancel_purchase_order" as any, { p_po_id: po.id } as any);
    if (error) toast({ title: "Not cancelled", description: error.message, variant: "destructive" });
    else toast({ title: `Order ${po.po_number} cancelled` });
    load();
  };

  const startReceive = async (po: PoRow) => {
    const { data, error } = await supabase.from("purchase_order_items" as any).select("*").eq("po_id", po.id);
    if (error) { toast({ title: "Could not open the order", description: error.message, variant: "destructive" }); return; }
    const items = ((data || []) as any[]).map((i) => ({
      ...i, quantity: Number(i.quantity), unit_cost: Number(i.unit_cost), gst_rate: Number(i.gst_rate),
      received_qty: Number(i.received_qty), free_qty: Number(i.free_qty), damaged_qty: Number(i.damaged_qty),
    })) as PoItem[];
    setGrn(items.map((item) => ({
      item, product: products.find((p) => p.id === item.product_id),
      good: String(Math.max(0, item.quantity - item.received_qty)), free: "", damaged: "",
      cost: String(item.unit_cost), gst: String(item.gst_rate), batch: "", expiry: "",
    })));
    setReceiving(po);
    setBillNo(""); setPaid("");
  };

  const setG = (id: string, patch: Partial<GrnLine>) => setGrn((g) => g.map((x) => x.item.id === id ? { ...x, ...patch } : x));
  const grnTotal = r2(grn.reduce((s, g) => {
    const t = r2((parseFloat(g.good) || 0) * (parseFloat(g.cost) || 0));
    return s + t + r2(t * (parseFloat(g.gst) || 0) / 100);
  }, 0));

  const saveReceive = async () => {
    if (!receiving) return;
    const whole = (v: string) => { const n = parseFloat(v) || 0; return n >= 0 && Number.isInteger(n); };
    if (grn.some((g) => !whole(g.good) || !whole(g.free) || !(parseFloat(g.damaged || "0") >= 0))) {
      toast({ title: "Use whole numbers of pieces", variant: "destructive" }); return;
    }
    const items = grn
      .map((g) => ({
        product_id: g.item.product_id, po_item_id: g.item.id,
        quantity: parseFloat(g.good) || 0, free_qty: parseFloat(g.free) || 0, damaged_qty: parseFloat(g.damaged) || 0,
        unit_cost: parseFloat(g.cost) || 0, gst_rate: parseFloat(g.gst) || 0,
      }))
      .filter((i) => i.quantity + i.free_qty + i.damaged_qty > 0);
    if (!items.some((i) => i.quantity + i.free_qty > 0)) { toast({ title: "Enter what arrived", variant: "destructive" }); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("receive_goods" as any, {
      p_supplier_id: receiving.supplier_id, p_items: items, p_bill_number: billNo.trim() || null, p_bill_date: billDate || null,
      p_paid_amount: parseFloat(paid) || 0, p_paid_method: paidMethod, p_note: null, p_po_id: receiving.id,
    } as any);
    if (error) { setBusy(false); toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    const batches = grn
      .filter((g) => (g.batch.trim() || g.expiry) && (parseFloat(g.good) || 0) + (parseFloat(g.free) || 0) > 0)
      .map((g) => ({ product_id: g.item.product_id, batch_no: g.batch.trim() || null, expiry_date: g.expiry || null,
        quantity: Math.round((parseFloat(g.good) || 0) + (parseFloat(g.free) || 0)), purchase_id: (data as any)?.id || null }));
    if (batches.length) {
      const { error: bErr } = await supabase.from("product_batches" as any).insert(batches as any);
      if (bErr) toast({ title: "Batch / expiry not saved", description: bErr.message, variant: "destructive" });
    }
    setBusy(false);
    const damaged = items.reduce((s, i) => s + i.damaged_qty, 0);
    toast({ title: "Goods received", description: `Stock added. Bill ${rupees(Number((data as any)?.total_amount || 0))}${damaged ? `. ${damaged} damaged piece(s) noted` : ""}` });
    setReceiving(null);
    load();
    onChanged();
  };

  return (
    <div className="space-y-4">
      {receiving ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Receive {receiving.po_number} from {receiving.suppliers?.name || "supplier"}</CardTitle>
            <Button size="icon" variant="ghost" aria-label="Close" onClick={() => setReceiving(null)}><X className="h-4 w-4" /></Button>
          </CardHeader>
          <CardContent className="space-y-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="w-20">Good</TableHead>
                  <TableHead className="w-20">Free</TableHead>
                  <TableHead className="w-20">Damaged</TableHead>
                  <TableHead className="w-24">Cost</TableHead>
                  <TableHead className="w-16">GST %</TableHead>
                  <TableHead className="w-24">Batch</TableHead>
                  <TableHead className="w-36">Expiry</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grn.map((g) => {
                  const name = g.product?.name || "Item";
                  return (
                    <TableRow key={g.item.id}>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell className="text-right text-sm">{g.item.quantity}{g.item.received_qty ? <div className="text-xs text-muted-foreground">{g.item.received_qty} came</div> : null}</TableCell>
                      <TableCell><Input type="number" min="0" aria-label={`Good pieces of ${name}`} value={g.good} onChange={(e) => setG(g.item.id, { good: e.target.value })} /></TableCell>
                      <TableCell><Input type="number" min="0" aria-label={`Free pieces of ${name}`} value={g.free} onChange={(e) => setG(g.item.id, { free: e.target.value })} /></TableCell>
                      <TableCell><Input type="number" min="0" aria-label={`Damaged pieces of ${name}`} value={g.damaged} onChange={(e) => setG(g.item.id, { damaged: e.target.value })} /></TableCell>
                      <TableCell><Input type="number" min="0" step="0.01" aria-label={`Cost of ${name}`} value={g.cost} onChange={(e) => setG(g.item.id, { cost: e.target.value })} /></TableCell>
                      <TableCell><Input type="number" min="0" step="0.01" aria-label={`GST of ${name}`} value={g.gst} onChange={(e) => setG(g.item.id, { gst: e.target.value })} /></TableCell>
                      <TableCell><Input aria-label={`Batch of ${name}`} value={g.batch} onChange={(e) => setG(g.item.id, { batch: e.target.value })} /></TableCell>
                      <TableCell><Input type="date" aria-label={`Expiry of ${name}`} value={g.expiry} onChange={(e) => setG(g.item.id, { expiry: e.target.value })} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">Good = pieces you pay for. Free = extra pieces at no cost. Damaged = pieces sent back at the door (not paid, not added to stock). Anything not yet arrived stays on the order.</p>
            <div className="grid gap-2 sm:grid-cols-5 items-end border-t pt-3">
              <div className="space-y-1"><Label htmlFor="grn-bill">Supplier bill no.</Label><Input id="grn-bill" value={billNo} onChange={(e) => setBillNo(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="grn-date">Bill date</Label><Input id="grn-date" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="grn-paid">Paid now</Label><Input id="grn-paid" type="number" min="0" placeholder="0" value={paid} onChange={(e) => setPaid(e.target.value)} /></div>
              <div className="space-y-1">
                <Label>By</Label>
                <Select value={paidMethod} onValueChange={setPaidMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="upi">UPI</SelectItem><SelectItem value="bank">Bank</SelectItem><SelectItem value="cheque">Cheque</SelectItem></SelectContent>
                </Select>
              </div>
              <Button onClick={saveReceive} disabled={busy} className="gap-2"><PackageCheck className="h-4 w-4" /> Save ({rupees(grnTotal)})</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-lg">New purchase order</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>Supplier</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger aria-label="Order supplier"><SelectValue placeholder={suppliers.length ? "Pick supplier" : "Add a supplier first"} /></SelectTrigger>
                  <SelectContent>{suppliers.map((s) => <SelectItem key={s.supplier_id} value={s.supplier_id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label htmlFor="po-exp">Deliver by (optional)</Label><Input id="po-exp" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="po-note">Note (optional)</Label><Input id="po-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Input className="flex-1 min-w-[12rem]" list="po-products" aria-label="Add product to order" placeholder="Type product name or scan, then Enter" value={pick}
                onChange={(e) => setPick(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPick(); } }} />
              <datalist id="po-products">{products.map((p) => <option key={p.id} value={p.name}>{p.sku}</option>)}</datalist>
              <Button type="button" variant="outline" className="gap-1" onClick={addPick}><Plus className="h-4 w-4" /> Add</Button>
              <Button type="button" variant="secondary" onClick={addLowStock}>Add low-stock items</Button>
            </div>
            {lines.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Product</TableHead><TableHead className="w-24">Qty</TableHead><TableHead className="w-28">Cost</TableHead><TableHead className="w-20">GST %</TableHead><TableHead></TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l) => (
                      <TableRow key={l.product.id}>
                        <TableCell><div className="font-medium">{l.product.name}</div><div className="text-xs text-muted-foreground">In stock: {l.product.stock_quantity ?? 0}</div></TableCell>
                        <TableCell><Input type="number" min="1" aria-label={`Order quantity of ${l.product.name}`} value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x) => x.product.id === l.product.id ? { ...x, quantity: e.target.value } : x))} /></TableCell>
                        <TableCell><Input type="number" min="0" step="0.01" aria-label={`Order cost of ${l.product.name}`} value={l.unitCost} onChange={(e) => setLines((ls) => ls.map((x) => x.product.id === l.product.id ? { ...x, unitCost: e.target.value } : x))} /></TableCell>
                        <TableCell><Input type="number" min="0" step="0.01" aria-label={`Order GST of ${l.product.name}`} value={l.gstRate} onChange={(e) => setLines((ls) => ls.map((x) => x.product.id === l.product.id ? { ...x, gstRate: e.target.value } : x))} /></TableCell>
                        <TableCell><Button size="icon" variant="ghost" aria-label={`Remove ${l.product.name} from order`} onClick={() => setLines((ls) => ls.filter((x) => x.product.id !== l.product.id))}><Trash2 className="h-4 w-4" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm">About {rupees(total)} with GST</span>
              <Button onClick={saveOrder} disabled={busy} className="gap-2"><Save className="h-4 w-4" /> Save order</Button>
            </div>
            <p className="text-xs text-muted-foreground">If the supplier has a phone number, WhatsApp opens with the order ready to send. Stock changes only when the goods arrive.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-lg">Orders</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {orders.length === 0 ? <p className="text-center text-muted-foreground py-4">No orders yet</p> : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Order</TableHead><TableHead>Supplier</TableHead><TableHead className="text-right">Value</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => {
                  const st = STATUS[o.status] || STATUS.open;
                  const late = o.expected_date && (o.status === "open" || o.status === "partial") && o.expected_date < new Date().toISOString().slice(0, 10);
                  return (
                    <TableRow key={o.id}>
                      <TableCell>
                        <div className="font-medium">{o.po_number}</div>
                        <div className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleDateString("en-IN")}{o.expected_date ? ` · by ${new Date(`${o.expected_date}T12:00:00+05:30`).toLocaleDateString("en-IN")}` : ""}</div>
                      </TableCell>
                      <TableCell>{o.suppliers?.name || "-"}</TableCell>
                      <TableCell className="text-right">{rupees(o.total_amount)}</TableCell>
                      <TableCell><Badge variant={st.variant}>{st.label}</Badge>{late && <div className="text-xs text-destructive">late</div>}</TableCell>
                      <TableCell className="text-right whitespace-nowrap space-x-1">
                        {(o.status === "open" || o.status === "partial") && (
                          <>
                            <Button size="sm" onClick={() => startReceive(o)}>Receive</Button>
                            <Button size="sm" variant="ghost" aria-label={`Send ${o.po_number} on WhatsApp`} onClick={() => sendAgain(o)}><MessageCircle className="h-4 w-4" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => cancel(o)}>Cancel</Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
