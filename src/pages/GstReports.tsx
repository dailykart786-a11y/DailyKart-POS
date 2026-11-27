import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/hooks/useStore";
import { toast } from "@/hooks/use-toast";
import { fetchStoreDetails } from "@/lib/invoice";
import {
  b2bInvoices, byRate, downloadCsv, hsnSummary, sum, totalTax,
  type PurchaseLine, type ReturnLine, type SaleLine, type TaxSplit,
} from "@/lib/gstReport";
import { FileSpreadsheet, Download, Landmark } from "lucide-react";

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PAGE = 1000;

// Supabase returns at most 1000 rows per request, so read in pages
async function fetchAll(build: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

const lastMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
};

export default function GstReports() {
  const { filterStoreId, workingStoreId, isAdmin, stores } = useStore();
  const [month, setMonth] = useState(lastMonth());
  const [loading, setLoading] = useState(false);
  const [sales, setSales] = useState<SaleLine[]>([]);
  const [returns, setReturns] = useState<ReturnLine[]>([]);
  const [purchases, setPurchases] = useState<PurchaseLine[]>([]);
  const [notes, setNotes] = useState<string[]>([]);

  const storeLabel = isAdmin && !filterStoreId && stores.length > 1 ? "All stores" : stores.find((s) => s.id === (filterStoreId || workingStoreId))?.name || "";

  const load = async () => {
    setLoading(true);
    const warn: string[] = [];
    try {
      const [y, m] = month.split("-").map(Number);
      // Month in India time
      const from = new Date(Date.UTC(y, m - 1, 1) - 330 * 60000).toISOString();
      const to = new Date(Date.UTC(y, m, 1) - 330 * 60000).toISOString();
      const fromDate = `${month}-01`;
      const toDate = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
      const store = await fetchStoreDetails(filterStoreId || workingStoreId);

      const itemRows = await fetchAll((a, b) => {
        let q = supabase.from("sale_items")
          .select("quantity, total_price, gst_amount, gst_rate, hsn_code, products(gst_rate, hsn_code), sales!inner(invoice_number, created_at, is_interstate, location_id, status, customers(name, gstin, state_code))")
          .gte("sales.created_at", from).lt("sales.created_at", to);
        if (filterStoreId) q = q.eq("sales.location_id", filterStoreId);
        return q.range(a, b);
      }).catch(async () => {
        // Older database without the GST columns: read what exists
        warn.push("Some GST details (HSN, customer GSTIN) need the latest database update.");
        return fetchAll((a, b) => {
          let q = supabase.from("sale_items")
            .select("quantity, total_price, gst_amount, products(gst_rate), sales!inner(invoice_number, created_at, location_id, status)")
            .gte("sales.created_at", from).lt("sales.created_at", to);
          if (filterStoreId) q = q.eq("sales.location_id", filterStoreId);
          return q.range(a, b);
        });
      });

      const toLine = (r: any): SaleLine => {
        const s = r.sales || {};
        const total = Number(r.total_price || 0);
        const tax = Number(r.gst_amount || 0);
        return {
          invoice: s.invoice_number,
          date: s.created_at,
          interstate: !!s.is_interstate,
          customerName: s.customers?.name ?? null,
          customerGstin: s.customers?.gstin || null,
          customerState: s.customers?.state_code || null,
          hsn: r.hsn_code ?? r.products?.hsn_code ?? null,
          rate: Number(r.gst_rate ?? r.products?.gst_rate ?? 0),
          quantity: Number(r.quantity || 0),
          taxable: Math.round((total - tax) * 100) / 100,
          tax,
        };
      };
      setSales(itemRows.filter((r) => (r.sales?.status || "completed") !== "cancelled").map(toLine));

      try {
        const retRows = await fetchAll((a, b) => {
          let q = supabase.from("sale_return_items" as any)
            .select("quantity, amount, gst_amount, sale_items(gst_rate, hsn_code), sale_returns!inner(return_number, created_at, location_id, sales(invoice_number, is_interstate, customers(name, gstin, state_code)))")
            .gte("sale_returns.created_at", from).lt("sale_returns.created_at", to);
          if (filterStoreId) q = q.eq("sale_returns.location_id", filterStoreId);
          return q.range(a, b);
        });
        setReturns(retRows.map((r: any) => {
          const sr = r.sale_returns || {};
          const amount = Number(r.amount || 0);
          const tax = Number(r.gst_amount || 0);
          return {
            creditNote: sr.return_number,
            invoice: sr.sales?.invoice_number,
            date: sr.created_at,
            interstate: !!sr.sales?.is_interstate,
            customerName: sr.sales?.customers?.name ?? null,
            customerGstin: sr.sales?.customers?.gstin || null,
            customerState: sr.sales?.customers?.state_code || null,
            hsn: r.sale_items?.hsn_code ?? null,
            rate: Number(r.sale_items?.gst_rate ?? 0),
            quantity: Number(r.quantity || 0),
            taxable: Math.round((amount - tax) * 100) / 100,
            tax,
          };
        }));
      } catch {
        setReturns([]);
      }

      try {
        const purRows = await fetchAll((a, b) => {
          let q = supabase.from("purchase_items" as any)
            .select("gst_rate, gst_amount, total, purchases!inner(bill_number, bill_date, location_id, suppliers(name, gstin, state_code))")
            .gte("purchases.bill_date", fromDate).lt("purchases.bill_date", toDate);
          if (filterStoreId) q = q.eq("purchases.location_id", filterStoreId);
          return q.range(a, b);
        });
        setPurchases(purRows.map((r: any) => {
          const p = r.purchases || {};
          const tax = Number(r.gst_amount || 0);
          const supState = p.suppliers?.state_code || (p.suppliers?.gstin ? String(p.suppliers.gstin).slice(0, 2) : null);
          return {
            supplier: p.suppliers?.name || "",
            supplierGstin: p.suppliers?.gstin || null,
            billNumber: p.bill_number,
            date: p.bill_date,
            interstate: !!(supState && store.state_code && supState !== store.state_code),
            rate: Number(r.gst_rate || 0),
            taxable: Math.round((Number(r.total || 0) - tax) * 100) / 100,
            tax,
          };
        }));
      } catch {
        setPurchases([]);
      }
      if (!store.gstin) warn.push("Add your GSTIN under Dashboard > Shop details on bills.");
      setNotes(warn);
    } catch (e: any) {
      toast({ title: "Report failed", description: e?.message || "Could not load GST data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, filterStoreId]);

  const outward = useMemo(() => sum(sales), [sales]);
  const creditNotes = useMemo(() => sum(returns), [returns]);
  const netOutward: TaxSplit = useMemo(() => ({
    taxable: outward.taxable - creditNotes.taxable,
    cgst: outward.cgst - creditNotes.cgst,
    sgst: outward.sgst - creditNotes.sgst,
    igst: outward.igst - creditNotes.igst,
  }), [outward, creditNotes]);
  const inward = useMemo(() => sum(purchases), [purchases]);
  const b2b = useMemo(() => b2bInvoices(sales), [sales]);
  const b2cRates = useMemo(() => byRate(sales.filter((s) => !s.customerGstin)), [sales]);
  const hsn = useMemo(() => hsnSummary(sales, returns), [sales, returns]);
  const invoiceNumbers = useMemo(() => Array.from(new Set(sales.map((s) => s.invoice))).sort(), [sales]);

  const payable = {
    cgst: Math.max(0, netOutward.cgst - inward.cgst),
    sgst: Math.max(0, netOutward.sgst - inward.sgst),
    igst: Math.max(0, netOutward.igst - inward.igst),
  };
  const f = (n: number) => n.toFixed(2);
  const fileTag = `${month}${storeLabel ? "-" + storeLabel.replace(/\W+/g, "_") : ""}`;

  const exportAll = () => {
    downloadCsv(`GSTR1-B2B-${fileTag}.csv`, b2b.map((r) => ({
      "GSTIN of recipient": r.gstin, "Receiver name": r.name, "Invoice number": r.invoice,
      "Invoice date": new Date(r.date).toLocaleDateString("en-IN"), "Invoice value": f(r.value),
      "Place of supply": r.interstate ? "Other state" : "Same state", Rate: r.rate,
      "Taxable value": f(r.taxable), CGST: f(r.cgst), SGST: f(r.sgst), IGST: f(r.igst),
    })));
    downloadCsv(`GSTR1-B2C-${fileTag}.csv`, b2cRates.map((r) => ({
      Rate: r.rate, "Taxable value": f(r.taxable), CGST: f(r.cgst), SGST: f(r.sgst), IGST: f(r.igst),
    })));
    downloadCsv(`GSTR1-HSN-${fileTag}.csv`, hsn.map((r) => ({
      HSN: r.hsn, Rate: r.rate, Quantity: r.quantity, "Taxable value": f(r.taxable),
      CGST: f(r.cgst), SGST: f(r.sgst), IGST: f(r.igst), "Total value": f(r.taxable + r.cgst + r.sgst + r.igst),
    })));
    if (returns.length) downloadCsv(`GSTR1-CreditNotes-${fileTag}.csv`, returns.map((r) => ({
      "Credit note": r.creditNote, "Original bill": r.invoice, Date: new Date(r.date).toLocaleDateString("en-IN"),
      "Customer GSTIN": r.customerGstin || "", Rate: r.rate, "Taxable value": f(r.taxable), Tax: f(r.tax),
    })));
    downloadCsv(`GSTR3B-Summary-${fileTag}.csv`, [
      { Section: "3.1(a) Outward taxable supplies (after credit notes)", "Taxable value": f(netOutward.taxable), CGST: f(netOutward.cgst), SGST: f(netOutward.sgst), IGST: f(netOutward.igst) },
      { Section: "4(A)(5) Input tax credit (purchases)", "Taxable value": f(inward.taxable), CGST: f(inward.cgst), SGST: f(inward.sgst), IGST: f(inward.igst) },
      { Section: "Estimated tax to pay (before cross-utilisation)", "Taxable value": "", CGST: f(payable.cgst), SGST: f(payable.sgst), IGST: f(payable.igst) },
    ]);
  };

  const Row = ({ label, t, bold }: { label: string; t: TaxSplit; bold?: boolean }) => (
    <TableRow className={bold ? "font-semibold" : ""}>
      <TableCell>{label}</TableCell>
      <TableCell className="text-right">{rupees(t.taxable)}</TableCell>
      <TableCell className="text-right">{rupees(t.cgst)}</TableCell>
      <TableCell className="text-right">{rupees(t.sgst)}</TableCell>
      <TableCell className="text-right">{rupees(t.igst)}</TableCell>
    </TableRow>
  );

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><FileSpreadsheet className="h-6 w-6" /> GST reports</h1>
            <p className="text-muted-foreground">Monthly figures for GSTR-1 and GSTR-3B{storeLabel ? ` · ${storeLabel}` : ""}</p>
          </div>
          <div className="flex gap-2 items-end">
            <div className="space-y-1">
              <Label htmlFor="gst-month">Month</Label>
              <Input id="gst-month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            </div>
            <Button onClick={exportAll} disabled={loading || !sales.length} className="gap-2"><Download className="h-4 w-4" /> Download for CA</Button>
          </div>
        </div>

        {notes.length > 0 && (
          <Card><CardContent className="p-4 text-sm text-muted-foreground space-y-1">{notes.map((n) => <p key={n}>{n}</p>)}</CardContent></Card>
        )}

        {loading ? <p className="text-muted-foreground">Loading...</p> : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Bills</p><p className="text-2xl font-bold">{invoiceNumbers.length}</p>
                {invoiceNumbers.length > 0 && <p className="text-xs text-muted-foreground">{invoiceNumbers[0]} to {invoiceNumbers[invoiceNumbers.length - 1]}</p>}</CardContent></Card>
              <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Output GST (after returns)</p><p className="text-2xl font-bold">{rupees(totalTax(netOutward))}</p></CardContent></Card>
              <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Estimated GST to pay</p><p className="text-2xl font-bold text-primary">{rupees(payable.cgst + payable.sgst + payable.igst)}</p>
                <p className="text-xs text-muted-foreground">After {rupees(totalTax(inward))} input credit</p></CardContent></Card>
            </div>

            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Landmark className="h-5 w-5" /> GSTR-3B summary</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead></TableHead><TableHead className="text-right">Taxable</TableHead><TableHead className="text-right">CGST</TableHead><TableHead className="text-right">SGST</TableHead><TableHead className="text-right">IGST</TableHead></TableRow></TableHeader>
                  <TableBody>
                    <Row label="Sales" t={outward} />
                    <Row label="Less: credit notes (returns)" t={creditNotes} />
                    <Row label="3.1(a) Net outward supplies" t={netOutward} bold />
                    <Row label="4(A) Input tax credit (purchases)" t={inward} />
                    <Row label="Estimated tax to pay" t={{ taxable: 0, ...payable }} bold />
                  </TableBody>
                </Table>
                <p className="text-xs text-muted-foreground mt-2">Estimate only. Your CA will apply cross-utilisation rules and any other credits when filing.</p>
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="text-lg">B2C sales by rate</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Rate</TableHead><TableHead className="text-right">Taxable</TableHead><TableHead className="text-right">Tax</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {b2cRates.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No sales</TableCell></TableRow> :
                        b2cRates.map((r) => (
                          <TableRow key={r.rate}><TableCell>{r.rate}%</TableCell><TableCell className="text-right">{rupees(r.taxable)}</TableCell><TableCell className="text-right">{rupees(r.cgst + r.sgst + r.igst)}</TableCell></TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-lg">B2B invoices ({new Set(b2b.map((b) => b.invoice)).size})</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto max-h-80">
                  <Table>
                    <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>GSTIN</TableHead><TableHead className="text-right">Taxable</TableHead><TableHead className="text-right">Tax</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {b2b.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No bills to customers with a GSTIN</TableCell></TableRow> :
                        b2b.map((r) => (
                          <TableRow key={`${r.invoice}-${r.rate}`}><TableCell className="font-mono text-xs">{r.invoice}</TableCell><TableCell className="font-mono text-xs">{r.gstin}</TableCell><TableCell className="text-right">{rupees(r.taxable)}</TableCell><TableCell className="text-right">{rupees(r.cgst + r.sgst + r.igst)}</TableCell></TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle className="text-lg">HSN summary</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto max-h-96">
                <Table>
                  <TableHeader><TableRow><TableHead>HSN</TableHead><TableHead>Rate</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Taxable</TableHead><TableHead className="text-right">CGST</TableHead><TableHead className="text-right">SGST</TableHead><TableHead className="text-right">IGST</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {hsn.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No sales</TableCell></TableRow> :
                      hsn.map((r) => (
                        <TableRow key={`${r.hsn}-${r.rate}`}>
                          <TableCell className={r.hsn === "NO HSN" ? "text-destructive" : ""}>{r.hsn}</TableCell><TableCell>{r.rate}%</TableCell><TableCell className="text-right">{r.quantity}</TableCell>
                          <TableCell className="text-right">{rupees(r.taxable)}</TableCell><TableCell className="text-right">{rupees(r.cgst)}</TableCell><TableCell className="text-right">{rupees(r.sgst)}</TableCell><TableCell className="text-right">{rupees(r.igst)}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
                {hsn.some((r) => r.hsn === "NO HSN") && <p className="text-xs text-destructive mt-2">Some products have no HSN code. Add it on the Products page.</p>}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
