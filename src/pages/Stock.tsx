import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useStore, inStore } from "@/hooks/useStore";
import { toast } from "@/hooks/use-toast";
import { downloadCsv } from "@/lib/gstReport";
import { Boxes, Download, MessageCircle, Printer, Save, CalendarClock } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Batch, BatchLeft, batchesWithLeft, daysUntil } from "@/lib/batches";

interface Product {
  id: string; name: string; sku: string; barcode: string | null; category: string | null;
  cost_price: number; stock_quantity: number; min_stock_level: number; base_unit: string | null;
}
interface LastBuy { supplier: string; cost: number; date: string; }
interface Adjustment {
  id: string; created_at: string; quantity_change: number; stock_before: number; stock_after: number;
  reason: string; note: string | null; products?: { name: string } | null;
}

const REASONS: Record<string, string> = {
  count: "Stock count",
  damaged: "Damaged",
  expired: "Expired",
  lost: "Lost / theft",
  own_use: "Shop / own use",
  found: "Found extra",
  opening: "Opening stock",
  other: "Other",
};

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** How many to order: enough to get back to twice the minimum, at least 1. */
export const suggestedOrder = (stock: number, min: number) => Math.max(1, Math.max(min, 1) * 2 - Math.max(stock, 0));

export default function Stock() {
  const { filterStoreId } = useStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [lastBuy, setLastBuy] = useState<Record<string, LastBuy>>({});
  const [history, setHistory] = useState<Adjustment[]>([]);
  const [historyMissing, setHistoryMissing] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchesMissing, setBatchesMissing] = useState(false);
  const [clearing, setClearing] = useState<{ batch: BatchLeft; remove: boolean } | null>(null);
  const [bPick, setBPick] = useState("");
  const [bProduct, setBProduct] = useState<Product | null>(null);
  const [bNo, setBNo] = useState("");
  const [bExpiry, setBExpiry] = useState("");
  const [bQty, setBQty] = useState("");
  const [busy, setBusy] = useState(false);

  const [pick, setPick] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [mode, setMode] = useState<"set" | "add" | "remove">("set");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("count");
  const [note, setNote] = useState("");

  const load = async () => {
    const pRes = await inStore(
      supabase.from("products").select("id, name, sku, barcode, category, cost_price, stock_quantity, min_stock_level, base_unit").eq("is_active", true),
      filterStoreId,
    ).order("name");
    const list = ((pRes.data || []) as any[]).map((p) => ({
      ...p,
      cost_price: Number(p.cost_price || 0),
      stock_quantity: Number(p.stock_quantity || 0),
      min_stock_level: Number(p.min_stock_level || 0),
    })) as Product[];
    setProducts(list);
    setProduct((cur) => (cur ? list.find((p) => p.id === cur.id) || null : null));

    // Last supplier and cost for each product (only if purchases are set up)
    const buys = await inStore(
      supabase.from("purchases" as any).select("bill_date, suppliers(name), purchase_items(product_id, unit_cost)"),
      filterStoreId,
    ).order("bill_date", { ascending: false }).order("created_at", { ascending: false }).limit(300);
    const map: Record<string, LastBuy> = {};
    if (!buys.error) {
      for (const b of (buys.data || []) as any[]) {
        for (const it of b.purchase_items || []) {
          if (map[it.product_id]) continue;
          map[it.product_id] = { supplier: b.suppliers?.name || "", cost: Number(it.unit_cost || 0), date: b.bill_date || "" };
        }
      }
    }
    setLastBuy(map);

    const hRes = await inStore(
      supabase.from("stock_adjustments" as any).select("id, created_at, quantity_change, stock_before, stock_after, reason, note, products(name)"),
      filterStoreId,
    ).order("created_at", { ascending: false }).limit(100);
    if (hRes.error) {
      setHistoryMissing(true);
      setHistory([]);
    } else {
      setHistoryMissing(false);
      setHistory((hRes.data || []) as any);
    }

    const bRes = await inStore(
      supabase.from("product_batches" as any).select("id, product_id, batch_no, expiry_date, quantity, created_at, cleared_at").is("cleared_at", null),
      filterStoreId,
    ).order("created_at", { ascending: false }).limit(2000);
    setBatchesMissing(!!bRes.error);
    setBatches(bRes.error ? [] : ((bRes.data || []) as any[]).map((b) => ({ ...b, quantity: Number(b.quantity) })));
  };

  const productById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const expiryList = useMemo(() => {
    const stock = Object.fromEntries(products.map((p) => [p.id, p.stock_quantity]));
    return batchesWithLeft(batches, stock)
      .filter((b) => b.expiry_date && b.left > 0)
      .sort((a, b) => (a.expiry_date || "").localeCompare(b.expiry_date || ""));
  }, [batches, products]);
  const expiringSoon = expiryList.filter((b) => daysUntil(b.expiry_date!) <= 30).length;

  const clearBatch = async () => {
    if (!clearing) return;
    const { batch, remove } = clearing;
    setBusy(true);
    try {
      if (remove && batch.left > 0) {
        const { error } = await supabase.rpc("adjust_stock" as any, {
          p_product_id: batch.product_id, p_quantity: -batch.left, p_reason: "expired", p_mode: "change",
          p_note: `Batch ${batch.batch_no || ""} expiry ${batch.expiry_date || ""}`.trim(),
        } as any);
        if (error) throw error;
      }
      const { error } = await supabase.from("product_batches" as any).update({ cleared_at: new Date().toISOString() } as any).eq("id", batch.id);
      if (error) throw error;
      toast({ title: remove ? "Removed from stock" : "Batch hidden", description: productById[batch.product_id]?.name });
      await load();
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message || "Failed", variant: "destructive" });
    } finally {
      setBusy(false);
      setClearing(null);
    }
  };

  const addBatch = async () => {
    const q = parseInt(bQty, 10);
    if (!bProduct) { toast({ title: "Pick a product", variant: "destructive" }); return; }
    if (!bNo.trim() && !bExpiry) { toast({ title: "Enter a batch number or expiry date", variant: "destructive" }); return; }
    if (!(q > 0)) { toast({ title: "Enter how many pieces are in this batch", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from("product_batches" as any).insert({
        product_id: bProduct.id, batch_no: bNo.trim() || null, expiry_date: bExpiry || null, quantity: q,
      } as any);
      if (error) throw error;
      toast({ title: "Batch saved", description: `${bProduct.name}${bExpiry ? `, expires ${bExpiry}` : ""}` });
      setBNo(""); setBExpiry(""); setBQty(""); setBProduct(null);
      await load();
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message || "Failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStoreId]);

  const reorder = useMemo(
    () => products
      .filter((p) => p.stock_quantity <= p.min_stock_level)
      .map((p) => ({ ...p, order: suggestedOrder(p.stock_quantity, p.min_stock_level), last: lastBuy[p.id] }))
      .sort((a, b) => a.stock_quantity - b.stock_quantity || a.name.localeCompare(b.name)),
    [products, lastBuy],
  );

  const summary = useMemo(() => ({
    items: products.length,
    value: products.reduce((s, p) => s + Math.max(p.stock_quantity, 0) * p.cost_price, 0),
    out: products.filter((p) => p.stock_quantity <= 0).length,
    low: products.filter((p) => p.stock_quantity > 0 && p.stock_quantity <= p.min_stock_level).length,
  }), [products]);

  const reorderRows = () => reorder.map((p) => ({
    Product: p.name, SKU: p.sku, "In stock": p.stock_quantity, Minimum: p.min_stock_level,
    "Order qty": p.order, Unit: p.base_unit || "pc", "Last supplier": p.last?.supplier || "", "Last cost": p.last?.cost ?? p.cost_price,
  }));

  const reorderText = () => {
    const bySupplier: Record<string, typeof reorder> = {};
    for (const p of reorder) (bySupplier[p.last?.supplier || "Other"] ||= []).push(p);
    const lines = ["*Order list*", new Date().toLocaleDateString("en-IN"), ""];
    for (const [sup, items] of Object.entries(bySupplier)) {
      lines.push(`*${sup}*`);
      for (const p of items) lines.push(`- ${p.name}: ${p.order} ${p.base_unit || "pc"}`);
      lines.push("");
    }
    return lines.join("\n").trim();
  };

  const printReorder = () => {
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) { toast({ title: "Allow pop-ups to print", variant: "destructive" }); return; }
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
    const rows = reorder.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.stock_quantity}</td><td><b>${p.order}</b> ${esc(p.base_unit || "pc")}</td><td>${esc(p.last?.supplier || "")}</td></tr>`).join("");
    w.document.write(`<html><head><title>Order list</title><style>body{font-family:sans-serif;padding:16px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px;text-align:left}</style></head><body><h2>Order list · ${new Date().toLocaleDateString("en-IN")}</h2><table><tr><th>Product</th><th>In stock</th><th>Order</th><th>Supplier</th></tr>${rows}</table><script>window.onload=()=>{window.print()}</script></body></html>`);
    w.document.close();
  };

  const choose = (term: string) => {
    const t = term.trim().toLowerCase();
    if (!t) return;
    const p = products.find((x) => (x.barcode || "").toLowerCase() === t)
      || products.find((x) => x.sku.toLowerCase() === t)
      || products.find((x) => x.name.toLowerCase() === t)
      || (products.filter((x) => x.name.toLowerCase().includes(t)).length === 1 ? products.find((x) => x.name.toLowerCase().includes(t)) : undefined);
    if (!p) { toast({ title: "Product not found", description: "Pick from the list or scan its barcode", variant: "destructive" }); return; }
    setProduct(p);
    setPick("");
    setQty(mode === "set" ? String(p.stock_quantity) : "");
  };

  const n = parseInt(qty, 10);
  const newStock = product && Number.isFinite(n)
    ? (mode === "set" ? n : mode === "add" ? product.stock_quantity + n : product.stock_quantity - n)
    : null;

  const save = async () => {
    if (!product) { toast({ title: "Pick a product", variant: "destructive" }); return; }
    if (!Number.isFinite(n) || n < 0 || String(n) !== qty.trim()) { toast({ title: "Enter a whole number", variant: "destructive" }); return; }
    if (newStock === null || newStock < 0) { toast({ title: "Stock can't go below 0", variant: "destructive" }); return; }
    if (newStock === product.stock_quantity) { toast({ title: "No change", description: `${product.name} is already ${product.stock_quantity}` }); return; }
    setBusy(true);
    try {
      const { error } = await supabase.rpc("adjust_stock" as any, {
        p_product_id: product.id,
        p_quantity: mode === "set" ? n : mode === "add" ? n : -n,
        p_reason: reason,
        p_mode: mode === "set" ? "set" : "change",
        p_note: note.trim() || null,
      } as any);
      if (error) {
        if (error.code === "PGRST202" || /adjust_stock/.test(error.message || "")) {
          throw new Error("Stock adjustment needs a database update. Ask your admin to run the latest dailykart-updates.sql in Supabase.");
        }
        throw error;
      }
      toast({ title: "Stock updated", description: `${product.name}: ${product.stock_quantity} → ${newStock}` });
      setQty(""); setNote("");
      await load();
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message || "Failed to adjust stock", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Boxes className="h-6 w-6" /> Stock</h1>
          <p className="text-muted-foreground">What to reorder, stock counts, and damaged or expired goods</p>
        </div>

        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Products</div><div className="text-2xl font-bold">{summary.items}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Stock value (at cost)</div><div className="text-2xl font-bold">{rupees(summary.value)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Out of stock</div><div className="text-2xl font-bold text-destructive">{summary.out}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Running low</div><div className="text-2xl font-bold text-warning">{summary.low}</div></CardContent></Card>
        </div>

        <datalist id="adj-products">
          {products.map((p) => <option key={p.id} value={p.name}>{p.sku}</option>)}
        </datalist>

        <Tabs defaultValue="reorder">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="reorder">Reorder list ({reorder.length})</TabsTrigger>
            <TabsTrigger value="adjust">Adjust stock</TabsTrigger>
            <TabsTrigger value="expiry">Expiry{expiringSoon ? ` (${expiringSoon})` : ""}</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="reorder">
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-lg">Items at or below their minimum</CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="gap-1" disabled={!reorder.length}
                    onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(reorderText())}`, "_blank")}>
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1" disabled={!reorder.length} onClick={printReorder}>
                    <Printer className="h-4 w-4" /> Print
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1" disabled={!reorder.length}
                    onClick={() => downloadCsv(`order-list-${new Date().toISOString().slice(0, 10)}.csv`, reorderRows())}>
                    <Download className="h-4 w-4" /> CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {reorder.length === 0 ? (
                  <p className="text-muted-foreground py-6 text-center">Nothing to reorder. Set a minimum stock on each product (Products page) to use this list.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">In stock</TableHead>
                        <TableHead className="text-right">Minimum</TableHead>
                        <TableHead className="text-right">Order</TableHead>
                        <TableHead>Last bought from</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reorder.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>
                            <div className="font-medium">{p.name}</div>
                            <div className="text-xs text-muted-foreground">{p.sku}</div>
                          </TableCell>
                          <TableCell className="text-right">
                            {p.stock_quantity <= 0 ? <Badge variant="destructive">{p.stock_quantity}</Badge> : p.stock_quantity}
                          </TableCell>
                          <TableCell className="text-right">{p.min_stock_level}</TableCell>
                          <TableCell className="text-right font-semibold">{p.order} {p.base_unit || "pc"}</TableCell>
                          <TableCell className="text-sm">
                            {p.last ? <>{p.last.supplier || "—"}<div className="text-xs text-muted-foreground">{rupees(p.last.cost)} on {p.last.date}</div></> : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="adjust">
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="adj-pick">Product</Label>
                  <div className="flex gap-2">
                    <Input id="adj-pick" list="adj-products" placeholder="Scan barcode or type product name, then Enter" value={pick}
                      onChange={(e) => setPick(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); choose(pick); } }} />
                    <Button type="button" variant="outline" onClick={() => choose(pick)} className="shrink-0">Select</Button>
                  </div>
                  {product && (
                    <div className="text-sm">
                      <span className="font-medium">{product.name}</span> · now in stock: <span className="font-semibold">{product.stock_quantity}</span> {product.base_unit || "pc"}
                    </div>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>What are you doing?</Label>
                    <Select value={mode} onValueChange={(v: any) => {
                      setMode(v);
                      setReason(v === "set" ? "count" : v === "add" ? "found" : "damaged");
                      setQty(v === "set" && product ? String(product.stock_quantity) : "");
                    }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="set">Counted stock (set the number)</SelectItem>
                        <SelectItem value="remove">Remove (damaged, expired...)</SelectItem>
                        <SelectItem value="add">Add (found, opening...)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="adj-qty">{mode === "set" ? "Counted quantity" : "Quantity"}</Label>
                    <Input id="adj-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
                    {product && newStock !== null && (
                      <div className={`text-xs ${newStock < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        New stock: {newStock} ({newStock - product.stock_quantity >= 0 ? "+" : ""}{newStock - product.stock_quantity})
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Reason</Label>
                    <Select value={reason} onValueChange={setReason}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(REASONS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adj-note">Note (optional)</Label>
                  <Input id="adj-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. rat damage in back store" />
                </div>
                <Button onClick={save} disabled={busy || !product} className="gap-2"><Save className="h-4 w-4" /> Save adjustment</Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="expiry" className="space-y-4">
            {batchesMissing ? (
              <Card><CardContent className="py-8 text-center text-muted-foreground">
                Expiry tracking needs a database update. Ask your admin to run the latest dailykart-updates.sql in Supabase.
              </CardContent></Card>
            ) : (
              <>
                <Card>
                  <CardHeader><CardTitle className="text-lg flex items-center gap-2"><CalendarClock className="h-5 w-5" /> Stock with an expiry date</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    {expiryList.length === 0 ? (
                      <p className="text-muted-foreground py-6 text-center">No batches with expiry dates in stock. Add the expiry when you enter a purchase, or below.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Product</TableHead>
                            <TableHead>Batch</TableHead>
                            <TableHead>Expiry</TableHead>
                            <TableHead className="text-right">Probably left</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {expiryList.map((b) => {
                            const d = daysUntil(b.expiry_date!);
                            return (
                              <TableRow key={b.id}>
                                <TableCell className="font-medium">{productById[b.product_id]?.name || "—"}</TableCell>
                                <TableCell>{b.batch_no || "—"}</TableCell>
                                <TableCell>
                                  {b.expiry_date}{" "}
                                  {d < 0 ? <Badge variant="destructive">Expired</Badge>
                                    : d <= 30 ? <Badge className="bg-warning text-warning-foreground">{d === 0 ? "Today" : `${d} days`}</Badge>
                                    : <span className="text-xs text-muted-foreground">{d} days</span>}
                                </TableCell>
                                <TableCell className="text-right">{b.left} of {b.quantity}</TableCell>
                                <TableCell className="text-right whitespace-nowrap">
                                  <Button size="sm" variant="outline" className="h-7 mr-1" disabled={busy} onClick={() => setClearing({ batch: b, remove: true })}>Remove from stock</Button>
                                  <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => setClearing({ batch: b, remove: false })}>Sold out</Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">"Probably left" assumes the oldest stock is sold first.</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-lg">Add expiry for stock already in the shop</CardTitle></CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-4 items-end">
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="b-pick">Product</Label>
                      <Input id="b-pick" list="adj-products" placeholder="Type product name, then Enter" value={bProduct ? bProduct.name : bPick}
                        onChange={(e) => { setBProduct(null); setBPick(e.target.value); }}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          const t = bPick.trim().toLowerCase();
                          const p = products.find((x) => x.name.toLowerCase() === t || (x.barcode || "").toLowerCase() === t || x.sku.toLowerCase() === t);
                          if (p) { setBProduct(p); setBQty(String(p.stock_quantity || "")); } else toast({ title: "Product not found", variant: "destructive" });
                        }}
                        onBlur={() => {
                          const p = products.find((x) => x.name.toLowerCase() === bPick.trim().toLowerCase());
                          if (p && !bProduct) { setBProduct(p); setBQty(String(p.stock_quantity || "")); }
                        }} />
                    </div>
                    <div className="space-y-2"><Label htmlFor="b-no">Batch no.</Label><Input id="b-no" value={bNo} onChange={(e) => setBNo(e.target.value)} /></div>
                    <div className="space-y-2"><Label htmlFor="b-exp">Expiry</Label><Input id="b-exp" type="date" value={bExpiry} onChange={(e) => setBExpiry(e.target.value)} /></div>
                    <div className="space-y-2"><Label htmlFor="b-qty">Pieces</Label><Input id="b-qty" inputMode="numeric" value={bQty} onChange={(e) => setBQty(e.target.value)} /></div>
                    <Button onClick={addBatch} disabled={busy} className="gap-2 sm:col-span-1"><Save className="h-4 w-4" /> Save batch</Button>
                  </CardContent>
                </Card>
              </>
            )}

            <AlertDialog open={!!clearing} onOpenChange={(o) => !o && setClearing(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{clearing?.remove ? "Remove this batch from stock?" : "Mark this batch as sold out?"}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {clearing?.remove
                      ? `${clearing.batch.left} of ${productById[clearing.batch.product_id]?.name || "this product"} will be taken off stock as expired, and the batch hidden from this list.`
                      : "The batch is hidden from this list. Stock is not changed."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={clearBatch}>{clearing?.remove ? "Remove from stock" : "Sold out"}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardContent className="p-4 overflow-x-auto">
                {historyMissing ? (
                  <p className="text-muted-foreground py-6 text-center">Stock history needs a database update. Ask your admin to run the latest dailykart-updates.sql in Supabase.</p>
                ) : history.length === 0 ? (
                  <p className="text-muted-foreground py-6 text-center">No stock adjustments yet</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead className="text-right">Change</TableHead>
                        <TableHead className="text-right">Stock</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((h) => (
                        <TableRow key={h.id}>
                          <TableCell className="text-sm whitespace-nowrap">{new Date(h.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                          <TableCell>{h.products?.name || "—"}</TableCell>
                          <TableCell>{REASONS[h.reason] || h.reason}{h.note ? <div className="text-xs text-muted-foreground">{h.note}</div> : null}</TableCell>
                          <TableCell className={`text-right font-medium ${h.quantity_change < 0 ? "text-destructive" : "text-green-600"}`}>{h.quantity_change > 0 ? "+" : ""}{h.quantity_change}</TableCell>
                          <TableCell className="text-right text-sm">{h.stock_before} → {h.stock_after}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
