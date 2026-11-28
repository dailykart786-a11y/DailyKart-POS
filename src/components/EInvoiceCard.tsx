import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { fetchStoreDetails, type StoreDetails } from "@/lib/invoice";
import {
  ackDateIso, downloadJson, parsePortalReply, printEInvoice, problems, toNicJson,
  type EInvBill, type EInvRecord,
} from "@/lib/eInvoice";
import { FileCode2, Printer } from "lucide-react";

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const missingDb = (e: any) => ["PGRST202", "PGRST205", "42P01"].includes(e?.code) || /e_invoice/.test(e?.message || "");

/** E-invoice (IRN) for bills to GST-registered customers, for one store and month. */
export function EInvoiceCard({ month, storeId }: { month: string; storeId: string | null }) {
  const [bills, setBills] = useState<EInvBill[]>([]);
  const [records, setRecords] = useState<EInvRecord[]>([]);
  const [seller, setSeller] = useState<StoreDetails | null>(null);
  const [dbReady, setDbReady] = useState(true);
  const [loading, setLoading] = useState(false);
  const [irnFor, setIrnFor] = useState<EInvBill | null>(null);
  const [cancelFor, setCancelFor] = useState<EInvBill | null>(null);
  const [form, setForm] = useState({ paste: "", irn: "", ackNo: "", ackDate: "", qr: "", reason: "" });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const [y, m] = month.split("-").map(Number);
      const from = new Date(Date.UTC(y, m - 1, 1) - 330 * 60000).toISOString();
      const to = new Date(Date.UTC(y, m, 1) - 330 * 60000).toISOString();
      const [store, salesRes] = await Promise.all([
        fetchStoreDetails(storeId),
        supabase.from("sales")
          .select("id, invoice_number, created_at, total_amount, is_interstate, status, customers!inner(name, gstin, state_code, address, phone, email), sale_items(quantity, unit_price, total_price, gst_amount, gst_rate, hsn_code, product_name, products(name, hsn_code, gst_rate, sold_by))")
          .eq("location_id", storeId).gte("created_at", from).lt("created_at", to)
          .not("customers.gstin", "is", null).neq("customers.gstin", "")
          .order("created_at"),
      ]);
      if (salesRes.error) throw salesRes.error;
      setSeller(store);
      const list: EInvBill[] = ((salesRes.data || []) as any[])
        .filter((s) => (s.status || "completed") !== "cancelled" && s.customers?.gstin)
        .map((s) => ({
          saleId: s.id, invoice: s.invoice_number, date: s.created_at, interstate: !!s.is_interstate, total: Number(s.total_amount || 0),
          buyer: { name: s.customers.name, gstin: s.customers.gstin, stateCode: s.customers.state_code, address: s.customers.address, phone: s.customers.phone, email: s.customers.email },
          lines: (s.sale_items || []).map((i: any) => ({
            name: i.product_name || i.products?.name || "Item", hsn: i.hsn_code ?? i.products?.hsn_code ?? null,
            quantity: Number(i.quantity || 0), unitPrice: Number(i.unit_price || 0), total: Number(i.total_price || 0),
            gst: Number(i.gst_amount || 0), gstRate: Number(i.gst_rate ?? i.products?.gst_rate ?? 0), soldBy: i.products?.sold_by ?? null,
          })),
        }));
      setBills(list);
      const ids = list.map((b) => b.saleId);
      if (ids.length) {
        const { data, error } = await supabase.from("e_invoices" as any).select("sale_id, irn, ack_no, ack_date, signed_qr, status, cancel_reason").in("sale_id", ids).order("created_at");
        if (error) { if (missingDb(error)) { setDbReady(false); setRecords([]); } else throw error; }
        else { setDbReady(true); setRecords((data || []) as unknown as EInvRecord[]); }
      } else setRecords([]);
    } catch (e: any) {
      toast({ title: "E-invoice list failed", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [month, storeId]);

  const recFor = (saleId: string) => {
    const mine = records.filter((r) => r.sale_id === saleId);
    return mine.find((r) => r.status === "active") || mine[mine.length - 1] || null;
  };
  const issues = useMemo(() => new Map(bills.map((b) => [b.saleId, seller ? problems(b, seller) : []])), [bills, seller]);
  const ready = bills.filter((b) => !(issues.get(b.saleId) || []).length && recFor(b.saleId)?.status !== "active");

  if (!storeId) {
    return <Card><CardHeader><CardTitle className="text-lg">E-invoice (IRN)</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Pick a store at the top of the screen first.</CardContent></Card>;
  }

  const download = () => {
    if (!seller || !ready.length) return;
    downloadJson(`e-invoice-${month}.json`, ready.map((b) => toNicJson(b, seller)));
    toast({ title: `${ready.length} bill${ready.length > 1 ? "s" : ""} ready to upload`, description: "Upload the file on the e-invoice portal, then save each IRN here" });
  };

  const openIrn = (b: EInvBill) => { setForm({ paste: "", irn: "", ackNo: "", ackDate: "", qr: "", reason: "" }); setIrnFor(b); };
  const onPaste = (text: string) => {
    const p = parsePortalReply(text);
    setForm((f) => ({ ...f, paste: text, irn: p.irn || f.irn, ackNo: p.ackNo || f.ackNo, ackDate: p.ackDate || f.ackDate, qr: p.signedQr || f.qr }));
  };
  const saveIrn = async () => {
    if (!irnFor) return;
    setBusy(true);
    const { error } = await supabase.rpc("save_e_invoice" as any, {
      p_sale_id: irnFor.saleId, p_irn: form.irn.trim(), p_ack_no: form.ackNo.trim() || null,
      p_ack_date: ackDateIso(form.ackDate), p_signed_qr: form.qr.trim() || null,
    });
    setBusy(false);
    if (error) { toast({ title: "IRN not saved", description: missingDb(error) ? "Run the latest database update first" : error.message, variant: "destructive" }); return; }
    toast({ title: `IRN saved on ${irnFor.invoice}` });
    setIrnFor(null);
    load();
  };
  const cancelIrn = async () => {
    if (!cancelFor) return;
    setBusy(true);
    const { error } = await supabase.rpc("cancel_e_invoice" as any, { p_sale_id: cancelFor.saleId, p_reason: form.reason });
    setBusy(false);
    if (error) { toast({ title: "Not cancelled", description: error.message, variant: "destructive" }); return; }
    toast({ title: `IRN of ${cancelFor.invoice} marked cancelled` });
    setCancelFor(null);
    load();
  };
  const print = async (b: EInvBill) => {
    const rec = recFor(b.saleId);
    if (!seller || !rec) return;
    try { await printEInvoice(b, seller, rec); } catch (e: any) { toast({ title: "Can't print", description: e?.message, variant: "destructive" }); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-lg flex items-center gap-2"><FileCode2 className="h-5 w-5" /> E-invoice (IRN)</CardTitle>
        <Button size="sm" className="gap-2" onClick={download} disabled={!ready.length}>Download JSON for the portal ({ready.length})</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Needed only if your yearly turnover is above ₹5 crore. Download the JSON, upload it on the government e-invoice portal (bulk upload),
          then paste what the portal gives back on each bill. The bill can then be printed with its IRN and QR code.
        </p>
        {!dbReady && <p className="text-sm text-amber-600">Saving IRNs needs the latest database update. Downloading the JSON works already.</p>}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Bill</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Value</TableHead><TableHead>E-invoice</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {loading ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
                : bills.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No bills to customers with a GSTIN this month</TableCell></TableRow>
                : bills.map((b) => {
                  const rec = recFor(b.saleId);
                  const errs = issues.get(b.saleId) || [];
                  return (
                    <TableRow key={b.saleId}>
                      <TableCell className="whitespace-nowrap">{b.invoice}<div className="text-xs text-muted-foreground">{new Date(b.date).toLocaleDateString("en-IN")}</div></TableCell>
                      <TableCell>{b.buyer.name}<div className="text-xs text-muted-foreground">{b.buyer.gstin}</div></TableCell>
                      <TableCell className="text-right">{rupees(b.total)}</TableCell>
                      <TableCell className="max-w-xs">
                        {rec?.status === "active" ? <><Badge>IRN saved</Badge><div className="text-xs text-muted-foreground break-all">{rec.irn.slice(0, 16)}…</div></>
                          : errs.length ? <><Badge variant="destructive">Fix first</Badge><ul className="text-xs text-destructive list-disc pl-4">{errs.map((e) => <li key={e}>{e}</li>)}</ul></>
                          : <Badge variant="secondary">{rec?.status === "cancelled" ? "IRN cancelled, ready again" : "Ready"}</Badge>}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap space-x-1">
                        {rec?.status === "active" ? <>
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => print(b)}><Printer className="h-3 w-3" /> Print</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setForm((f) => ({ ...f, reason: "" })); setCancelFor(b); }}>Cancel IRN</Button>
                        </> : <>
                          {seller && !errs.length && <Button size="sm" variant="ghost" onClick={() => downloadJson(`e-invoice-${b.invoice.replace(/\W+/g, "_")}.json`, [toNicJson(b, seller)])}>JSON</Button>}
                          <Button size="sm" variant="outline" disabled={!dbReady || !!errs.length} onClick={() => openIrn(b)}>Add IRN</Button>
                        </>}
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={!!irnFor} onOpenChange={(o) => !o && setIrnFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Save IRN for {irnFor?.invoice}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="einv-paste">Paste what the portal gave back (optional)</Label>
              <Textarea id="einv-paste" rows={3} value={form.paste} onChange={(e) => onPaste(e.target.value)} placeholder='The JSON reply, or text with the IRN in it' />
            </div>
            <div className="space-y-1"><Label htmlFor="einv-irn">IRN (64 characters)</Label><Input id="einv-irn" value={form.irn} onChange={(e) => setForm({ ...form, irn: e.target.value.trim() })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label htmlFor="einv-ack">Ack no.</Label><Input id="einv-ack" value={form.ackNo} onChange={(e) => setForm({ ...form, ackNo: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="einv-ackdt">Ack date</Label><Input id="einv-ackdt" placeholder="2026-11-27 12:30:00" value={form.ackDate} onChange={(e) => setForm({ ...form, ackDate: e.target.value })} /></div>
            </div>
            <div className="space-y-1"><Label htmlFor="einv-qr">Signed QR code (for printing)</Label><Textarea id="einv-qr" rows={2} value={form.qr} onChange={(e) => setForm({ ...form, qr: e.target.value.trim() })} /></div>
            <Button className="w-full" onClick={saveIrn} disabled={busy || !/^[0-9a-fA-F]{64}$/.test(form.irn)}>Save IRN</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelFor} onOpenChange={(o) => !o && setCancelFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Cancel IRN of {cancelFor?.invoice}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Cancel it on the e-invoice portal first (allowed within 24 hours). This only records it here; the bill itself stays.</p>
            <div className="space-y-1"><Label htmlFor="einv-reason">Why</Label><Input id="einv-reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. wrong buyer address" /></div>
            <Button variant="destructive" className="w-full" onClick={cancelIrn} disabled={busy || !form.reason.trim()}>Mark IRN cancelled</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
