// Invoice-wise sales (Phase 8): every bill in the dates, paged on the server,
// with search, filters, the bill's lines on click, and export of every
// matching bill (not just the page). Figures come from report_invoices.
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterOptions, InvoiceLines, InvoiceRow, InvoiceStatus, reportFilterOptions, reportInvoiceLines, reportInvoices } from "@/lib/reports/api";
import { ReportCtx, allPages, csvMeta, csvName, useReportData } from "./context";
import { Kpi, Loaded, METHOD_LABEL, NoData, Section, inr, num } from "./shared";
import { Pager, useDebounced } from "./paging";
import { NeedsUpdate as Needs, useMissing } from "./missing";

const R = "text-right";
const ANY = "__any";
const NeedsUpdate = () => <Needs file="phase8-reports-invoices.sql" />;
const methodName = (m: string) => METHOD_LABEL[m] ?? (m === "split" ? "Split" : m);
const when = (s: string) => new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
const STATUSES: { key: InvoiceStatus; label: string }[] = [
  { key: "all", label: "All bills" }, { key: "completed", label: "Not cancelled" }, { key: "credit", label: "With udhaar" },
  { key: "returned", label: "With returns" }, { key: "cancelled", label: "Cancelled" },
];
const SORTS = [{ key: "date", label: "Newest first" }, { key: "date_asc", label: "Oldest first" }, { key: "total", label: "Biggest bill" }, { key: "items", label: "Most items" }];

const splitText = (r: InvoiceRow) =>
  r.payment_split ? Object.entries(r.payment_split).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${methodName(k)} ${inr(Number(v))}`).join(" + ") : methodName(r.method);

const shortPay = (r: InvoiceRow) =>
  r.payment_split ? Object.entries(r.payment_split).filter(([, v]) => Number(v) > 0).map(([k]) => (k === "credit" ? "Udhaar" : methodName(k))).join(" + ") : methodName(r.method);

const csvRow = (r: InvoiceRow) => ({
  bill_number: r.invoice_number, date_time: when(r.created_at), customer: r.customer_name ?? "Walk-in", phone: r.phone ?? "", staff: r.cashier ?? "",
  payment: splitText(r).replace(/₹/g, ""), status: r.status, interstate: r.interstate ? "yes" : "", items: r.lines, units: r.units,
  discount: r.discount, taxable_value: r.taxable, gst: r.gst, bill_total: r.billed, udhaar: r.credit, returned: r.returned,
});

function BillSheet({ row, onClose }: { row: InvoiceRow | null; onClose: () => void }) {
  const [data, setData] = useState<InvoiceLines | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!row) return;
    let live = true;
    setData(null); setErr(false);
    reportInvoiceLines(row.id).then((r) => { if (!live) return; if (r.status === "ok") setData(r.data); else setErr(true); });
    return () => { live = false; };
  }, [row]);
  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle>Bill {row.invoice_number}</SheetTitle>
              <SheetDescription>{when(row.created_at)} · {row.customer_name ?? "Walk-in"}{row.cashier ? ` · by ${row.cashier}` : ""}</SheetDescription>
            </SheetHeader>
            <div className="grid grid-cols-2 gap-2 text-sm mt-4">
              <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">Bill total</div>{inr(row.billed, 2)}</div>
              <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">Paid by</div>{splitText(row)}</div>
              <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">Taxable + GST</div>{inr(row.taxable, 2)} + {inr(row.gst, 2)}</div>
              <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">Discount</div>{inr(row.discount, 2)}</div>
            </div>
            {err && <p className="text-sm text-destructive mt-4">Couldn't load the bill lines.</p>}
            {!data && !err && <p className="text-sm text-muted-foreground mt-4">Loading…</p>}
            {data && (
              <>
                <Table className="mt-4">
                  <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className={R}>Qty</TableHead><TableHead className={R}>Rate</TableHead><TableHead className={R}>Amount</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.lines.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell>{l.name}<div className="text-xs text-muted-foreground">GST {l.gst_rate}%{l.discount_pct ? ` · ${l.discount_pct}% off` : ""}{l.hsn ? ` · HSN ${l.hsn}` : ""}</div>
                          {l.returned_qty > 0 && <Badge variant="outline" className="mt-1 text-destructive border-destructive/40">{num(l.returned_qty)} returned</Badge>}</TableCell>
                        <TableCell className={R}>{num(l.qty)}</TableCell><TableCell className={R}>{inr(l.unit_price, 2)}</TableCell>
                        <TableCell className={R}>{inr(l.total, 2)}<div className="text-xs text-muted-foreground">GST {inr(l.gst, 2)}</div></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {data.returns.length > 0 && (
                  <div className="mt-4 space-y-1 text-sm">
                    <div className="font-medium">Returns</div>
                    {data.returns.map((r) => (
                      <div key={r.return_number} className="flex justify-between gap-2 text-muted-foreground">
                        <span>{r.return_number} · {when(r.created_at)}{r.reason ? ` · ${r.reason}` : ""}</span><span className="text-destructive">{inr(r.refund_amount, 2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function InvoiceReportView({ ctx }: { ctx: ReportCtx }) {
  const [missing, onMissing] = useMissing();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [method, setMethod] = useState<string | null>(null);
  const [cashier, setCashier] = useState<string | null>(null);
  const [status, setStatus] = useState<InvoiceStatus>("all");
  const [sort, setSort] = useState("date");
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const [open, setOpen] = useState<InvoiceRow | null>(null);
  const [opts, setOpts] = useState<FilterOptions | null>(null);
  useEffect(() => { setPage(0); }, [q, method, cashier, status, sort, ctx.run, ctx.storeId]);
  useEffect(() => {
    let live = true;
    reportFilterOptions(ctx.storeId).then((r) => { if (live && r.status === "ok") setOpts(r.data); });
    return () => { live = false; };
  }, [ctx.storeId]);
  const filters = {
    search: q || null, method, cashierId: cashier, status,
    sort: sort === "date_asc" ? "date" : sort, dir: (sort === "date_asc" ? "asc" : "desc") as "asc" | "desc",
  };
  const state = useReportData(
    () => reportInvoices(ctx.range.from, ctx.range.to, ctx.storeId, { ...filters, limit: size, offset: page * size }),
    [ctx.run, ctx.storeId, q, method, cashier, status, sort, page, size], onMissing,
  );
  if (missing) return <NeedsUpdate />;

  const filterLines = [
    ...(q ? [`Search: ${q}`] : []), ...(method ? [`Payment: ${methodName(method)}`] : []),
    ...(cashier ? [`Staff: ${opts?.staff.find((s) => s.id === cashier)?.name ?? "one person"}`] : []),
    ...(status !== "all" ? [`Bills: ${STATUSES.find((s) => s.key === status)?.label}`] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-full sm:w-64">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Bill number, customer or phone" className="pl-8 h-9" aria-label="Search bills" />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as InvoiceStatus)}>
          <SelectTrigger className="h-9 w-[150px]" aria-label="Which bills"><SelectValue /></SelectTrigger>
          <SelectContent>{STATUSES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={method ?? ANY} onValueChange={(v) => setMethod(v === ANY ? null : v)}>
          <SelectTrigger className="h-9 w-[140px]" aria-label="Payment"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any payment</SelectItem>
            {(opts?.methods ?? []).filter((m) => m !== "split").map((m) => <SelectItem key={m} value={m}>{methodName(m)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={cashier ?? ANY} onValueChange={(v) => setCashier(v === ANY ? null : v)}>
          <SelectTrigger className="h-9 w-[150px]" aria-label="Staff"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any staff</SelectItem>
            {(opts?.staff ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="h-9 w-[140px]" aria-label="Sort"><SelectValue /></SelectTrigger>
          <SelectContent>{SORTS.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Loaded state={state} kpis={4}>
        {(iv) => {
          const t = iv.totals;
          if (iv.total === 0) return <NoData title="No bills match" description={filterLines.length ? "Try clearing the search or a filter." : "No bills in these dates."} />;
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi label="Bills" value={num(t.bills)} hint={t.cancelled ? `${t.cancelled} cancelled, not counted` : `${num(t.customers)} saved customers`} />
                <Kpi label="Billed (with GST)" value={inr(t.billed)} hint={`taxable ${inr(t.taxable)}`} />
                <Kpi label="GST on bills" value={inr(t.gst, 2)} hint={`discounts ${inr(t.discount)}`} />
                <Kpi label="Udhaar on bills" value={inr(t.credit)} hint={t.returned ? `returned ${inr(t.returned)}` : "no returns"} />
              </div>
              <Section title="Bills" description="Click a bill to see its items and any returns. Cancelled bills are listed but not added to the totals."
                csv={{ filename: csvName(ctx, "invoices"), meta: csvMeta(ctx, "Invoice-wise sales", [...filterLines, `Rows ${page * size + 1} to ${page * size + iv.rows.length} of ${iv.total}`]),
                  rows: iv.rows.map(csvRow), all: allPages((limit, offset) => reportInvoices(ctx.range.from, ctx.range.to, ctx.storeId, { ...filters, limit, offset }), csvRow) }}>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="min-w-[120px]">Bill</TableHead><TableHead className="min-w-[120px]">Customer</TableHead><TableHead>Payment</TableHead>
                    <TableHead className={R}>Items</TableHead><TableHead className={R}>GST</TableHead><TableHead className={R}>Total</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {iv.rows.map((r) => (
                      <TableRow key={r.id} className={`cursor-pointer ${r.status === "cancelled" ? "opacity-60" : ""}`} tabIndex={0}
                        onClick={() => setOpen(r)} onKeyDown={(e) => { if (e.key === "Enter") setOpen(r); }}>
                        <TableCell className="whitespace-nowrap"><span className="font-medium">{r.invoice_number}</span><div className="text-xs text-muted-foreground">{when(r.created_at)}</div></TableCell>
                        <TableCell>{r.customer_name ?? <span className="text-muted-foreground">Walk-in</span>}<div className="text-xs text-muted-foreground">{r.cashier ? `by ${r.cashier}` : " "}</div></TableCell>
                        <TableCell className="text-sm">
                          <div className="max-w-[150px]">{shortPay(r)}</div>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {r.status === "cancelled" && <Badge variant="outline">Cancelled</Badge>}
                            {r.credit > 0 && r.method !== "credit" && !r.payment_split && <Badge variant="outline" className="text-warning border-warning/50">Udhaar {inr(r.credit)}</Badge>}
                            {r.returned > 0 && <Badge variant="outline" className="text-destructive border-destructive/40">Returned {inr(r.returned)}</Badge>}
                            {r.interstate && <Badge variant="outline">IGST</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className={R}>{num(r.lines)}<div className="text-xs text-muted-foreground">{num(r.units)} units</div></TableCell>
                        <TableCell className={R}>{inr(r.gst, 2)}</TableCell>
                        <TableCell className={R}><span className="font-medium">{inr(r.billed, 2)}</span>
                          <div className="text-xs text-muted-foreground whitespace-nowrap">{r.discount > 0 ? `${inr(r.discount)} off · ` : ""}{inr(r.taxable)} + GST</div></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Pager page={page} size={size} total={iv.total} setPage={setPage} setSize={setSize} />
              </Section>
            </div>
          );
        }}
      </Loaded>
      <BillSheet row={open} onClose={() => setOpen(null)} />
    </div>
  );
}
