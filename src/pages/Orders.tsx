import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useStore, inStore } from "@/hooks/useStore";
import { toast } from "@/hooks/use-toast";
import { rupees } from "@/lib/statement";
import { findProduct, type PoProduct } from "@/components/PurchaseOrdersTab";
import { ClipboardList, MessageCircle, Plus, Printer, Receipt, Trash2 } from "lucide-react";

type Status = "new" | "packing" | "ready" | "out_for_delivery" | "delivered" | "cancelled";
interface OrderItem { product_id: string; name: string; quantity: number; price: number; }
interface Order {
  id: string; order_number: string; location_id: string; customer_id: string | null; customer_name: string | null; phone: string | null;
  address: string | null; channel: string; delivery_type: "delivery" | "pickup"; status: Status; expected_at: string | null;
  assigned_staff_id: string | null; note: string | null; estimated_total: number; sale_id: string | null; created_at: string;
  customer_order_items?: OrderItem[]; sales?: { invoice_number: string; total_amount: number; payment_method: string } | null;
}
interface Cust { id: string; name: string; phone: string | null; address: string | null; }
interface StaffLite { id: string; name: string; }
interface Line { product: PoProduct & { price?: number }; quantity: string; }

const STATUS_LABEL: Record<Status, string> = {
  new: "New", packing: "Packing", ready: "Ready", out_for_delivery: "Out for delivery", delivered: "Delivered", cancelled: "Cancelled",
};
const NEXT: Record<Status, { to: Status; label: string }[]> = {
  new: [{ to: "packing", label: "Start packing" }],
  packing: [{ to: "ready", label: "Packed" }],
  ready: [{ to: "out_for_delivery", label: "Send out" }, { to: "delivered", label: "Handed over" }],
  out_for_delivery: [{ to: "delivered", label: "Delivered" }],
  delivered: [], cancelled: [],
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const waPhone = (p: string | null) => { const d = (p || "").replace(/\D/g, ""); return d.length === 10 ? `91${d}` : d; };

export default function Orders() {
  const { filterStoreId, workingStoreId, stores } = useStore();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [view, setView] = useState<"open" | "done">("open");
  const [products, setProducts] = useState<(PoProduct & { price?: number })[]>([]);
  const [customers, setCustomers] = useState<Cust[]>([]);
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [creating, setCreating] = useState(false);
  const [billing, setBilling] = useState<Order | null>(null);

  const load = async () => {
    const { data, error } = await inStore(
      supabase.from("customer_orders" as any).select("*, customer_order_items(product_id, name, quantity, price), sales(invoice_number, total_amount, payment_method)"),
      filterStoreId,
    ).order("created_at", { ascending: false }).limit(200);
    if (error) {
      if (["PGRST205", "42P01"].includes(error.code || "") || /could not find the table/i.test(error.message || "")) { setAvailable(false); return; }
      toast({ title: "Couldn't load orders", description: error.message, variant: "destructive" });
    }
    setAvailable(true);
    setOrders(((data || []) as any[]).map((o) => ({ ...o, estimated_total: Number(o.estimated_total) })));
  };
  const loadRefs = async () => {
    const [p, c, s] = await Promise.all([
      inStore(supabase.from("products").select("id, name, sku, barcode, cost_price, gst_rate, stock_quantity, price, location_id").eq("is_active", true), filterStoreId).order("name"),
      inStore(supabase.from("customers").select("id, name, phone, address, location_id"), filterStoreId).order("name").limit(1000),
      inStore(supabase.from("staff" as any).select("id, name, location_id").eq("is_active", true), filterStoreId).order("name"),
    ]);
    setProducts(((p.data || []) as any[]).map((x) => ({ ...x, cost_price: Number(x.cost_price) || 0, price: Number(x.price) || 0 })));
    setCustomers((c.data || []) as any);
    setStaff(s.error ? [] : ((s.data || []) as any));
  };

  useEffect(() => {
    load(); loadRefs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStoreId]);

  const shown = useMemo(() => orders.filter((o) => (view === "open" ? !["delivered", "cancelled"].includes(o.status) : ["delivered", "cancelled"].includes(o.status))), [orders, view]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    orders.forEach((o) => { c[o.status] = (c[o.status] || 0) + 1; });
    return c;
  }, [orders]);

  if (available === false) {
    return <Layout><Card><CardContent className="py-10 text-center text-muted-foreground">Orders and delivery need the latest database update (dailykart-updates.sql). Everything else keeps working.</CardContent></Card></Layout>;
  }

  const setStatus = async (o: Order, to: Status) => {
    let reason: string | null = null;
    if (to === "cancelled") {
      reason = window.prompt(`Cancel ${o.order_number}? Reason (optional):`);
      if (reason === null) return;
    }
    const { error } = await supabase.rpc("set_order_status" as any, { p_order_id: o.id, p_status: to, p_reason: reason } as any);
    if (error) { toast({ title: "Not changed", description: error.message, variant: "destructive" }); return; }
    toast({ title: `${o.order_number}: ${STATUS_LABEL[to]}` });
    load();
  };
  const assign = async (o: Order, staffId: string) => {
    const { error } = await supabase.from("customer_orders" as any).update({ assigned_staff_id: staffId === "none" ? null : staffId } as any).eq("id", o.id);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    load();
  };
  const whatsapp = (o: Order) => {
    const total = o.sales ? rupees(Number(o.sales.total_amount)) : `about ${rupees(o.estimated_total)}`;
    const msg = `Hello ${o.customer_name || ""}, your order ${o.order_number} is ${STATUS_LABEL[o.status].toLowerCase()}. Amount ${total}. Thank you!`;
    window.open(`https://wa.me/${waPhone(o.phone)}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
  };
  const printSlip = (o: Order) => {
    const shop = stores.find((s) => s.id === o.location_id)?.name || "DailyKart";
    const rows = (o.customer_order_items || []).map((i) => `<tr><td>${esc(i.name)}</td><td class="n">${Number(i.quantity)}</td><td style="width:24px;border:1px solid #999"></td></tr>`).join("");
    const w = window.open("", "_blank");
    if (!w) { toast({ title: "Allow pop-ups to print", variant: "destructive" }); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.order_number)}</title>
<style>body{font-family:Arial,sans-serif;font-size:13px;margin:12px;max-width:80mm}table{width:100%;border-collapse:collapse}td{padding:4px 2px;border-bottom:1px dashed #ccc}.n{text-align:right}</style></head><body>
<b>${esc(shop)}</b><br>${o.delivery_type === "delivery" ? "Delivery" : "Pickup"} slip <b>${esc(o.order_number)}</b><br>
${esc(o.customer_name || "")} ${o.phone ? "· " + esc(o.phone) : ""}<br>${o.address ? esc(o.address) + "<br>" : ""}${o.expected_at ? "By " + esc(when(o.expected_at)) + "<br>" : ""}
<table>${rows}</table>
<p>${o.sales ? `Bill ${esc(o.sales.invoice_number)} · ${rupees(Number(o.sales.total_amount))} · ${esc(o.sales.payment_method === "credit" ? "udhaar" : o.sales.payment_method)}` : `About ${rupees(o.estimated_total)} (not billed yet)`}</p>
${o.note ? `<p>Note: ${esc(o.note)}</p>` : ""}</body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  };

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardList className="h-6 w-6" /> Orders &amp; delivery</h1>
            <p className="text-sm text-muted-foreground">Phone and WhatsApp orders, packing, delivery and billing.</p>
          </div>
          <Button className="gap-1" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New order</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={view === "open" ? "default" : "outline"} onClick={() => setView("open")}>Open</Button>
          <Button size="sm" variant={view === "done" ? "default" : "outline"} onClick={() => setView("done")}>Delivered &amp; cancelled</Button>
          {(["new", "packing", "ready", "out_for_delivery"] as Status[]).map((s) => <Badge key={s} variant="secondary">{STATUS_LABEL[s]}: {counts[s] || 0}</Badge>)}
        </div>

        {shown.length === 0 ? <Card><CardContent className="py-8 text-center text-muted-foreground">{view === "open" ? "No open orders" : "Nothing here yet"}</CardContent></Card> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((o) => (
              <Card key={o.id} className={o.status === "cancelled" ? "opacity-60" : ""}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
                    <span>{o.order_number}</span>
                    <span className="flex gap-1">
                      <Badge variant="outline">{o.delivery_type === "delivery" ? "Delivery" : "Pickup"}</Badge>
                      <Badge variant={o.status === "new" ? "destructive" : "secondary"}>{STATUS_LABEL[o.status]}</Badge>
                    </span>
                  </CardTitle>
                  <div className="text-sm">
                    <div className="font-medium">{o.customer_name}{o.phone ? ` · ${o.phone}` : ""}</div>
                    {o.address && <div className="text-muted-foreground">{o.address}</div>}
                    <div className="text-xs text-muted-foreground">{o.channel} · {when(o.created_at)}{o.expected_at ? ` · by ${when(o.expected_at)}` : ""}</div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div>{(o.customer_order_items || []).map((i, k) => <div key={k} className="flex justify-between"><span>{i.name}</span><span>× {Number(i.quantity)}</span></div>)}</div>
                  {o.note && <div className="text-xs rounded bg-muted p-2">{o.note}</div>}
                  <div className="flex justify-between border-t pt-2">
                    {o.sales ? <span>Bill {o.sales.invoice_number} · <b>{rupees(Number(o.sales.total_amount))}</b></span> : <span>About <b>{rupees(o.estimated_total)}</b> · <span className="text-destructive">not billed</span></span>}
                  </div>
                  {o.delivery_type === "delivery" && staff.length > 0 && !["delivered", "cancelled"].includes(o.status) && (
                    <Select value={o.assigned_staff_id || "none"} onValueChange={(v) => assign(o, v)}>
                      <SelectTrigger className="h-8" aria-label={`Delivery person for ${o.order_number}`}><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="none">No delivery person</SelectItem>{staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  <div className="flex flex-wrap gap-1 pt-1">
                    {!o.sale_id && o.status !== "cancelled" && <Button size="sm" className="gap-1" onClick={() => setBilling(o)}><Receipt className="h-4 w-4" /> Bill</Button>}
                    {NEXT[o.status].filter((n) => o.delivery_type === "delivery" || n.to !== "out_for_delivery").map((n) => (
                      <Button key={n.to} size="sm" variant="outline" onClick={() => setStatus(o, n.to)}>{n.label}</Button>
                    ))}
                    <Button size="sm" variant="ghost" aria-label={`Print slip ${o.order_number}`} onClick={() => printSlip(o)}><Printer className="h-4 w-4" /></Button>
                    {o.phone && <Button size="sm" variant="ghost" aria-label={`WhatsApp ${o.order_number}`} onClick={() => whatsapp(o)}><MessageCircle className="h-4 w-4" /></Button>}
                    {!o.sale_id && !["delivered", "cancelled"].includes(o.status) && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setStatus(o, "cancelled")}>Cancel</Button>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
      {creating && <NewOrderDialog products={products} customers={customers} storeId={workingStoreId} onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />}
      {billing && <BillDialog order={billing} onClose={() => setBilling(null)} onDone={() => { setBilling(null); load(); }} />}
    </Layout>
  );
}

function NewOrderDialog({ products, customers, storeId, onClose, onDone }: {
  products: (PoProduct & { price?: number })[]; customers: Cust[]; storeId: string | null; onClose: () => void; onDone: () => void;
}) {
  const [customerId, setCustomerId] = useState("none");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [channel, setChannel] = useState("phone");
  const [type, setType] = useState("delivery");
  const [expected, setExpected] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);

  const pickCustomer = (id: string) => {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    if (c) { setName(c.name); setPhone(c.phone || ""); setAddress(c.address || ""); }
  };
  const addPick = () => {
    const p = findProduct(products, pick);
    if (!p) { toast({ title: "Product not found", variant: "destructive" }); return; }
    setLines((ls) => ls.some((l) => l.product.id === p.id) ? ls.map((l) => l.product.id === p.id ? { ...l, quantity: String((parseFloat(l.quantity) || 0) + 1) } : l) : [...ls, { product: p, quantity: "1" }]);
    setPick("");
  };
  const est = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (l.product.price || 0) * (1 + (l.product.gst_rate || 0) / 100), 0);

  const save = async () => {
    if (!lines.length) { toast({ title: "Add the items", variant: "destructive" }); return; }
    if (lines.some((l) => !(parseFloat(l.quantity) > 0))) { toast({ title: "Check the quantities", variant: "destructive" }); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("create_customer_order" as any, {
      p_items: lines.map((l) => ({ product_id: l.product.id, quantity: parseFloat(l.quantity) })),
      p_customer_id: customerId === "none" ? null : customerId, p_customer_name: name.trim() || null, p_phone: phone.trim() || null,
      p_address: address.trim() || null, p_channel: channel, p_delivery_type: type,
      p_expected_at: expected ? new Date(expected).toISOString() : null, p_note: note.trim() || null, p_location_id: storeId,
    } as any);
    setBusy(false);
    if (error) { toast({ title: "Order not saved", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Order ${(data as any)?.order_number || ""} saved` });
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New order</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Saved customer</Label>
              <Select value={customerId} onValueChange={pickCustomer}>
                <SelectTrigger aria-label="Saved customer"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">New / walk-in</SelectItem>
                  {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Came by</Label>
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger aria-label="Order came by"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="phone">Phone</SelectItem><SelectItem value="whatsapp">WhatsApp</SelectItem><SelectItem value="counter">Counter</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger aria-label="Delivery or pickup"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="delivery">Home delivery</SelectItem><SelectItem value="pickup">Pickup</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1"><Label htmlFor="ord-name">Name</Label><Input id="ord-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="ord-phone">Phone</Label><Input id="ord-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            {type === "delivery" && <div className="space-y-1 sm:col-span-2"><Label htmlFor="ord-address">Delivery address</Label><Textarea id="ord-address" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></div>}
            <div className="space-y-1"><Label htmlFor="ord-when">{type === "delivery" ? "Deliver by" : "Pickup at"}</Label><Input id="ord-when" type="datetime-local" value={expected} onChange={(e) => setExpected(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="ord-note">Note</Label><Input id="ord-note" placeholder="e.g. ring the bell, pay by UPI" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          </div>
          <div className="flex gap-2">
            <Input list="ord-products" aria-label="Add product to order" placeholder="Type product name or scan, then Enter" value={pick}
              onChange={(e) => setPick(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPick(); } }} />
            <datalist id="ord-products">{products.map((p) => <option key={p.id} value={p.name}>{p.sku}</option>)}</datalist>
            <Button type="button" variant="outline" className="gap-1 shrink-0" onClick={addPick}><Plus className="h-4 w-4" /> Add</Button>
          </div>
          {lines.map((l) => (
            <div key={l.product.id} className="flex items-center gap-2">
              <div className="flex-1 text-sm"><div className="font-medium">{l.product.name}</div><div className="text-xs text-muted-foreground">{rupees(l.product.price || 0)} · in stock {l.product.stock_quantity ?? 0}</div></div>
              <Input className="w-24" type="number" min="0" step="any" aria-label={`Order quantity of ${l.product.name}`} value={l.quantity}
                onChange={(e) => setLines((ls) => ls.map((x) => x.product.id === l.product.id ? { ...x, quantity: e.target.value } : x))} />
              <Button size="icon" variant="ghost" aria-label={`Remove ${l.product.name} from order`} onClick={() => setLines((ls) => ls.filter((x) => x.product.id !== l.product.id))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-sm">About <b>{rupees(Math.round(est * 100) / 100)}</b> <span className="text-muted-foreground">(offers apply when billed)</span></span>
            <Button onClick={save} disabled={busy}>Save order</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BillDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  const bill = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("bill_customer_order" as any, { p_order_id: order.id, p_payment_method: method, p_payments: null } as any);
    setBusy(false);
    if (error) { toast({ title: "Not billed", description: error.message, variant: "destructive" }); return; }
    const s = data as any;
    toast({ title: `Bill ${s?.invoice_number || ""} made`, description: s?.total_amount != null ? rupees(Number(s.total_amount)) : undefined });
    onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Bill {order.order_number}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Makes a normal bill for these items: stock goes down and offers, GST and udhaar limits apply.</p>
          <div className="space-y-1">
            <Label>Payment</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger aria-label="Order payment"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash (or cash on delivery)</SelectItem>
                <SelectItem value="upi">UPI</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                {order.customer_id && <SelectItem value="credit">Udhaar (khata)</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" onClick={bill} disabled={busy}>Make bill</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
