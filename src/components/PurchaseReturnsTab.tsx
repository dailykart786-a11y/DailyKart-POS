import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useStore, inStore } from "@/hooks/useStore";
import { toast } from "@/hooks/use-toast";
import { rupees } from "@/lib/statement";
import { findProduct, type PoProduct, type PoSupplier } from "@/components/PurchaseOrdersTab";
import { Plus, Printer, Trash2, Undo2 } from "lucide-react";

interface RetLine { product: PoProduct; quantity: string; unitCost: string; gstRate: string; }
interface RetRow { id: string; return_number: string; total_amount: number; reason: string | null; created_at: string; suppliers?: { name: string; gstin?: string | null } | null; }

const r2 = (n: number) => Math.round(n * 100) / 100;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/** Send goods back to a supplier: stock goes down and what you owe goes down (debit note). */
export function PurchaseReturnsTab({ products, suppliers, onChanged }: { products: PoProduct[]; suppliers: PoSupplier[]; onChanged: () => void }) {
  const { filterStoreId, stores } = useStore();
  const [available, setAvailable] = useState(true);
  const [returns, setReturns] = useState<RetRow[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<RetLine[]>([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data, error } = await inStore(
      supabase.from("purchase_returns" as any).select("id, return_number, total_amount, reason, created_at, location_id, suppliers(name, gstin)"),
      filterStoreId,
    ).order("created_at", { ascending: false }).limit(50);
    if (error) { setAvailable(false); return; }
    setAvailable(true);
    setReturns(((data || []) as any[]).map((r) => ({ ...r, total_amount: Number(r.total_amount) })));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStoreId]);

  if (!available) {
    return <Card><CardContent className="py-8 text-center text-muted-foreground">Purchase returns need the latest database update (dailykart-updates.sql).</CardContent></Card>;
  }

  const addPick = () => {
    const p = findProduct(products, pick);
    if (!p) { toast({ title: "Product not found", variant: "destructive" }); return; }
    setLines((ls) => ls.some((l) => l.product.id === p.id) ? ls : [...ls, { product: p, quantity: "1", unitCost: String(p.cost_price ?? 0), gstRate: String(p.gst_rate ?? 0) }]);
    setPick("");
  };
  const setL = (id: string, patch: Partial<RetLine>) => setLines((ls) => ls.map((l) => l.product.id === id ? { ...l, ...patch } : l));
  const total = r2(lines.reduce((s, l) => {
    const t = r2((parseFloat(l.quantity) || 0) * (parseFloat(l.unitCost) || 0));
    return s + t + r2(t * (parseFloat(l.gstRate) || 0) / 100);
  }, 0));

  const printNote = async (r: RetRow) => {
    const { data } = await supabase.from("purchase_return_items" as any).select("product_id, quantity, unit_cost, gst_rate, gst_amount, total").eq("return_id", r.id);
    const rows = ((data || []) as any[]).map((i) => `<tr><td>${esc(products.find((p) => p.id === i.product_id)?.name || "Item")}</td><td class="n">${Number(i.quantity)}</td><td class="n">${rupees(Number(i.unit_cost))}</td><td class="n">${Number(i.gst_rate)}%</td><td class="n">${rupees(Number(i.total))}</td></tr>`).join("");
    const shop = stores.find((s) => s.id === (r as any).location_id)?.name || "DailyKart";
    const w = window.open("", "_blank");
    if (!w) { toast({ title: "Allow pop-ups to print", variant: "destructive" }); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Debit note ${esc(r.return_number)}</title>
<style>body{font-family:Arial,sans-serif;font-size:12px;margin:16px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ccc;padding:4px;text-align:left}.n{text-align:right}</style></head><body>
<h2 style="margin:0">${esc(shop)}</h2><h3>Debit note ${esc(r.return_number)}</h3>
<p>To: <b>${esc(r.suppliers?.name || "")}</b>${r.suppliers?.gstin ? ` (GSTIN ${esc(r.suppliers.gstin)})` : ""}<br>Date: ${new Date(r.created_at).toLocaleDateString("en-IN")}${r.reason ? `<br>Reason: ${esc(r.reason)}` : ""}</p>
<table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">GST</th><th class="n">Amount</th></tr></thead><tbody>${rows}</tbody>
<tfoot><tr><td colspan="4"><b>Total</b></td><td class="n"><b>${rupees(r.total_amount)}</b></td></tr></tfoot></table>
<p style="margin-top:24px">Goods returned as above. Please adjust our account.</p></body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  const save = async () => {
    if (!supplierId) { toast({ title: "Pick the supplier", variant: "destructive" }); return; }
    if (!lines.length) { toast({ title: "Add the items going back", variant: "destructive" }); return; }
    if (lines.some((l) => !(parseFloat(l.quantity) > 0) || !Number.isInteger(parseFloat(l.quantity)))) { toast({ title: "Use whole pieces", variant: "destructive" }); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("create_purchase_return" as any, {
      p_supplier_id: supplierId,
      p_items: lines.map((l) => ({ product_id: l.product.id, quantity: parseFloat(l.quantity), unit_cost: parseFloat(l.unitCost) || 0, gst_rate: parseFloat(l.gstRate) || 0 })),
      p_reason: reason.trim() || null, p_purchase_id: null,
    } as any);
    setBusy(false);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    const r = data as any;
    toast({ title: `Debit note ${r.return_number} saved`, description: `Stock reduced; you owe ${rupees(Number(r.total_amount))} less` });
    setLines([]); setReason("");
    load();
    onChanged();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Undo2 className="h-5 w-5" /> Return goods to a supplier</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger aria-label="Return supplier"><SelectValue placeholder="Pick supplier" /></SelectTrigger>
                <SelectContent>{suppliers.map((s) => <SelectItem key={s.supplier_id} value={s.supplier_id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label htmlFor="pr-reason">Reason</Label><Input id="pr-reason" placeholder="e.g. expired, damaged, wrong item" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          </div>
          <div className="flex gap-2">
            <Input list="pr-products" aria-label="Add product to return" placeholder="Type product name or scan, then Enter" value={pick}
              onChange={(e) => setPick(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPick(); } }} />
            <datalist id="pr-products">{products.map((p) => <option key={p.id} value={p.name}>{p.sku}</option>)}</datalist>
            <Button type="button" variant="outline" className="gap-1 shrink-0" onClick={addPick}><Plus className="h-4 w-4" /> Add</Button>
          </div>
          {lines.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="w-24">Qty</TableHead><TableHead className="w-28">Cost</TableHead><TableHead className="w-20">GST %</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.product.id}>
                      <TableCell><div className="font-medium">{l.product.name}</div><div className="text-xs text-muted-foreground">In stock: {l.product.stock_quantity ?? 0}</div></TableCell>
                      <TableCell><Input type="number" min="1" aria-label={`Return quantity of ${l.product.name}`} value={l.quantity} onChange={(e) => setL(l.product.id, { quantity: e.target.value })} /></TableCell>
                      <TableCell><Input type="number" min="0" step="0.01" aria-label={`Return cost of ${l.product.name}`} value={l.unitCost} onChange={(e) => setL(l.product.id, { unitCost: e.target.value })} /></TableCell>
                      <TableCell><Input type="number" min="0" step="0.01" aria-label={`Return GST of ${l.product.name}`} value={l.gstRate} onChange={(e) => setL(l.product.id, { gstRate: e.target.value })} /></TableCell>
                      <TableCell><Button size="icon" variant="ghost" aria-label={`Remove ${l.product.name} from return`} onClick={() => setLines((ls) => ls.filter((x) => x.product.id !== l.product.id))}><Trash2 className="h-4 w-4" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="flex items-center justify-between border-t pt-3">
            <span className="font-medium">Debit note total {rupees(total)}</span>
            <Button onClick={save} disabled={busy}>Save return</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Debit notes</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {returns.length === 0 ? <p className="text-center text-muted-foreground py-4">No returns to suppliers yet</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Note</TableHead><TableHead>Supplier</TableHead><TableHead>Reason</TableHead><TableHead className="text-right">Amount</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {returns.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><div className="font-medium">{r.return_number}</div><div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString("en-IN")}</div></TableCell>
                    <TableCell>{r.suppliers?.name || "-"}</TableCell>
                    <TableCell className="text-sm">{r.reason || "-"}</TableCell>
                    <TableCell className="text-right">{rupees(r.total_amount)}</TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="ghost" aria-label={`Print ${r.return_number}`} onClick={() => printNote(r)}><Printer className="h-4 w-4" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
