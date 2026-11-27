import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
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
import { fetchStoreDetails, stateName } from "@/lib/invoice";
import { Undo2, Search, Printer } from "lucide-react";

interface BillItem {
  id: string;
  product_id: string;
  name: string;
  quantity: number;
  returned: number;
  unit_price: number;
  total_price: number;
}

interface Bill {
  id: string;
  invoice_number: string;
  created_at: string;
  total_amount: number;
  payment_method: string | null;
  customer_id: string | null;
  customer_name: string | null;
  location_id: string;
  items: BillItem[];
}

interface ReturnRow {
  id: string;
  return_number: string;
  refund_amount: number;
  refund_method: string;
  reason: string | null;
  created_at: string;
  sales?: { invoice_number: string } | null;
}

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export default function Returns() {
  const { filterStoreId } = useStore();
  const [billNo, setBillNo] = useState("");
  const [bill, setBill] = useState<Bill | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [method, setMethod] = useState("cash");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<ReturnRow[]>([]);
  const [unavailable, setUnavailable] = useState(false);

  const loadRecent = async () => {
    const { data, error } = await inStore(
      supabase.from("sale_returns" as any).select("*, sales(invoice_number)"),
      filterStoreId
    ).order("created_at", { ascending: false }).limit(20);
    if (error) {
      if (/sale_returns/.test(error.message) || error.code === "PGRST205" || error.code === "42P01") setUnavailable(true);
      return;
    }
    setUnavailable(false);
    setRecent((data || []) as any);
  };

  useEffect(() => {
    loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStoreId]);

  const findBill = async () => {
    const term = billNo.trim();
    if (!term) return;
    setBusy(true);
    try {
      const { data: sales, error } = await inStore(
        supabase.from("sales").select("*, customers(name)").ilike("invoice_number", `%${term}%`),
        filterStoreId
      ).order("created_at", { ascending: false }).limit(1);
      if (error) throw error;
      const sale = (sales || [])[0] as any;
      if (!sale) {
        toast({ title: "Bill not found", description: `No bill matching ${term}`, variant: "destructive" });
        setBill(null);
        return;
      }
      const [itemsRes, retRes] = await Promise.all([
        supabase.from("sale_items").select("*, products(name)").eq("sale_id", sale.id),
        supabase.from("sale_return_items" as any).select("sale_item_id, quantity, sale_returns!inner(sale_id)").eq("sale_returns.sale_id", sale.id),
      ]);
      if (itemsRes.error) throw itemsRes.error;
      const returned: Record<string, number> = {};
      for (const r of ((retRes.data || []) as any[])) returned[r.sale_item_id] = (returned[r.sale_item_id] || 0) + Number(r.quantity);
      setBill({
        id: sale.id,
        invoice_number: sale.invoice_number,
        created_at: sale.created_at,
        total_amount: Number(sale.total_amount),
        payment_method: sale.payment_method,
        customer_id: sale.customer_id,
        customer_name: sale.customers?.name || null,
        location_id: sale.location_id,
        items: ((itemsRes.data || []) as any[]).map((i) => ({
          id: i.id,
          product_id: i.product_id,
          name: i.products?.name || "Item",
          quantity: Number(i.quantity),
          returned: returned[i.id] || 0,
          unit_price: Number(i.unit_price),
          total_price: Number(i.total_price),
        })),
      });
      setQty({});
      setReason("");
      setMethod(sale.payment_method === "credit" && sale.customer_id ? "khata" : sale.payment_method === "upi" ? "upi" : "cash");
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "Failed to find bill", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const lineRefund = (it: BillItem) => {
    const q = parseFloat(qty[it.id] || "0") || 0;
    return Math.round((it.total_price * q / it.quantity) * 100) / 100;
  };
  const refundTotal = bill ? bill.items.reduce((s, it) => s + lineRefund(it), 0) : 0;

  const printCreditNote = async (ret: any, items: { name: string; quantity: number; amount: number }[]) => {
    const store = await fetchStoreDetails(bill?.location_id);
    const w = window.open("", "_blank");
    if (!w) return;
    const st = stateName(store.state_code);
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(ret.return_number)}</title>
<style>@page{size:80mm auto;margin:3mm}body{margin:0;font-family:monospace;font-size:12px;width:74mm}.c{text-align:center}.b{font-weight:bold}.r{display:flex;justify-content:space-between}.d{border-top:1px dashed #000;margin:6px 0}</style></head><body>
<div class="c b">${esc(store.business_name)}</div>
${store.gstin ? `<div class="c">GSTIN: ${esc(store.gstin)}</div>` : ""}${st ? `<div class="c">State: ${esc(st)}</div>` : ""}
<div class="d"></div><div class="c b">CREDIT NOTE</div>
<div>No: ${esc(ret.return_number)}</div><div>Against bill: ${esc(bill?.invoice_number)}</div>
<div>Date: ${new Date(ret.created_at).toLocaleString("en-IN")}</div>
${bill?.customer_name ? `<div>Customer: ${esc(bill.customer_name)}</div>` : ""}
<div class="d"></div>
${items.map((i) => `<div class="r"><span>${esc(i.name)} x ${i.quantity}</span><span>${i.amount.toFixed(2)}</span></div>`).join("")}
<div class="d"></div>
<div class="r"><span>GST included</span><span>${Number(ret.tax_amount).toFixed(2)}</span></div>
<div class="r b"><span>REFUND</span><span>Rs ${Number(ret.refund_amount).toFixed(2)}</span></div>
<div>Refunded by: ${esc(String(ret.refund_method).toUpperCase())}</div>
${ret.reason ? `<div>Reason: ${esc(ret.reason)}</div>` : ""}
</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 250);
  };

  const saveReturn = async () => {
    if (!bill) return;
    const items = bill.items
      .map((it) => ({ it, q: parseFloat(qty[it.id] || "0") || 0 }))
      .filter((x) => x.q > 0);
    if (!items.length) {
      toast({ title: "Nothing to return", description: "Enter how many of each item came back", variant: "destructive" });
      return;
    }
    for (const { it, q } of items) {
      if (q > it.quantity - it.returned + 1e-9) {
        toast({ title: "Too many", description: `${it.name}: only ${it.quantity - it.returned} can be returned`, variant: "destructive" });
        return;
      }
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("create_return" as any, {
        p_sale_id: bill.id,
        p_items: items.map(({ it, q }) => ({ sale_item_id: it.id, quantity: q })),
        p_refund_method: method,
        p_reason: reason.trim() || null,
      } as any);
      if (error) throw error;
      const ret = data as any;
      toast({ title: "Return saved", description: `${ret.return_number}: refund ${rupees(Number(ret.refund_amount))} by ${String(ret.refund_method).toUpperCase()}` });
      await printCreditNote(ret, items.map(({ it, q }) => ({ name: it.name, quantity: q, amount: lineRefund(it) })));
      setBill(null);
      setBillNo("");
      loadRecent();
    } catch (e: any) {
      toast({ title: "Return not saved", description: e?.message || "Failed to save return", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Undo2 className="h-6 w-6" /> Returns</h1>
          <p className="text-muted-foreground">Take items back against a bill. Stock goes back and a credit note is printed.</p>
        </div>

        {unavailable ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">
            Returns need a database update. Ask your admin to run the latest dailykart-updates.sql in Supabase.
          </CardContent></Card>
        ) : (
          <>
            <Card>
              <CardContent className="p-4 flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-10" placeholder="Bill number, e.g. 0042 or DK/26-27/0042" value={billNo}
                    onChange={(e) => setBillNo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") findBill(); }} />
                </div>
                <Button onClick={findBill} disabled={busy || !billNo.trim()}>Find bill</Button>
              </CardContent>
            </Card>

            {bill && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    Bill {bill.invoice_number} · {new Date(bill.created_at).toLocaleDateString("en-IN")} · {rupees(bill.total_amount)}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {bill.customer_name || "Walk-in customer"} · paid by {(bill.payment_method || "cash").toUpperCase()}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Sold</TableHead>
                          <TableHead className="text-right">Returned</TableHead>
                          <TableHead className="w-28">Return now</TableHead>
                          <TableHead className="text-right">Refund</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bill.items.map((it) => {
                          const left = Math.round((it.quantity - it.returned) * 1000) / 1000;
                          return (
                            <TableRow key={it.id}>
                              <TableCell>{it.name}</TableCell>
                              <TableCell className="text-right">{it.quantity}</TableCell>
                              <TableCell className="text-right">{it.returned || "-"}</TableCell>
                              <TableCell>
                                <Input type="number" min="0" max={left} step="any" disabled={left <= 0}
                                  aria-label={`Return quantity for ${it.name}`}
                                  value={qty[it.id] || ""} placeholder="0"
                                  onChange={(e) => setQty((q) => ({ ...q, [it.id]: e.target.value }))} />
                              </TableCell>
                              <TableCell className="text-right">{lineRefund(it) ? rupees(lineRefund(it)) : ""}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3 items-end">
                    <div className="space-y-2">
                      <Label>Refund by</Label>
                      <Select value={method} onValueChange={setMethod}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="upi">UPI</SelectItem>
                          <SelectItem value="card">Card</SelectItem>
                          {bill.customer_id && <SelectItem value="khata">Reduce khata (udhaar)</SelectItem>}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="ret-reason">Reason (optional)</Label>
                      <Input id="ret-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Damaged, wrong size, expired..." />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <p className="text-lg">Refund: <span className="font-bold">{rupees(refundTotal)}</span></p>
                    <Button onClick={saveReturn} disabled={busy || refundTotal <= 0} className="gap-2">
                      <Printer className="h-4 w-4" /> {busy ? "Saving..." : "Save return and print credit note"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">For an exchange, save the return here, then make a new bill for the replacement item.</p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader><CardTitle className="text-lg">Recent returns</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                {recent.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">No returns yet</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Credit note</TableHead>
                        <TableHead>Bill</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Refund by</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recent.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono text-sm">{r.return_number}</TableCell>
                          <TableCell className="font-mono text-sm">{r.sales?.invoice_number || "-"}</TableCell>
                          <TableCell>{new Date(r.created_at).toLocaleDateString("en-IN")}</TableCell>
                          <TableCell><Badge variant="outline">{r.refund_method.toUpperCase()}</Badge></TableCell>
                          <TableCell className="text-right">{rupees(Number(r.refund_amount))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
