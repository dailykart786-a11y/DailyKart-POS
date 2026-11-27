import { useCallback, useEffect, useMemo, useState } from "react";
import { DateRange } from "react-day-picker";
import {
  Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart,
} from "recharts";
import { AlertTriangle, Download, FileText, Info } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePickerWithRange } from "@/components/ui/date-picker";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip as Tip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CardGridSkeleton, ChartSkeleton, EmptyState, ErrorState } from "@/components/feedback";
import { LegacyReports } from "@/components/reports/LegacyReports";
import { useStore } from "@/hooks/useStore";
import { friendlyError } from "@/lib/friendlyError";
import { downloadCsv, indiaToday, inr as inrBase, inrShort } from "@/lib/dashboard";
import {
  CustomerReport, ExpenseReport, PeriodReport, ProductReport, ReportResult, TrendRow,
  grainFor, isoDate, reportCustomers, reportExpenses, reportPeriod, reportProducts, reportTrend,
} from "@/lib/reports/api";
import { COST_MISSING_NOTE, KPI } from "@/lib/reports/definitions";

type ReportType = "sales" | "profit" | "customer" | "product" | "expense";

const TITLES: Record<ReportType, { title: string; about: string }> = {
  sales: { title: "Sales report", about: "What was sold, discounts, returns and GST, day by day." },
  profit: { title: "Profit & loss", about: "Net sales, cost of what was sold, expenses and profit." },
  customer: { title: "Customer analysis", about: "Who bought in this period, how often, how much, and what they owe." },
  product: { title: "Product performance", about: "Units, sales, returns, cost and profit for each product." },
  expense: { title: "Expense breakdown", about: "Approved expenses by category and by how they were paid." },
};

const PAGE_SIZE = 25;
const COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--warning))", "hsl(var(--destructive))", "hsl(var(--success))", "hsl(var(--muted-foreground))"];

interface Loaded {
  type: ReportType; from: string; to: string;
  period?: PeriodReport; trend?: TrendRow[]; products?: ProductReport; customers?: CustomerReport; expenses?: ExpenseReport;
}

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const fmtBucket = (b: string) =>
  /^\d{2}:00$/.test(b) ? b : new Date(b + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });

/** ₹ amount with a proper minus sign in front (−₹50, not ₹-50). */
const inr = (n: number | undefined, decimals = 0) => (n !== undefined && n < 0 ? `−${inrBase(-n, decimals)}` : inrBase(n, decimals));

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toFixed(1)}%`);

function Kpi({ k, value, tone }: { k: keyof typeof KPI | string; value: string; tone?: "good" | "bad" }) {
  const def = KPI[k];
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <span>{def?.label ?? k}</span>
          {def && (
            <Tip>
              <TooltipTrigger asChild>
                <button type="button" aria-label={`How ${def.label} is worked out`} className="text-muted-foreground hover:text-foreground">
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>{def.how}</p>
                <p className="mt-1 text-xs opacity-80">From: {def.source}</p>
              </TooltipContent>
            </Tip>
          )}
        </div>
        <div className={`text-xl md:text-2xl font-bold mt-1 ${tone === "bad" ? "text-destructive" : tone === "good" ? "text-success" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

export default function Reports() {
  const { filterStoreId, stores } = useStore();
  const [reportType, setReportType] = useState<ReportType>("sales");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const t = indiaToday();
    return { from: new Date(addDays(t, -29) + "T00:00:00"), to: new Date(t + "T00:00:00") };
  });
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [missing, setMissing] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const range = useMemo(() => {
    const t = indiaToday();
    const from = dateRange?.from ? isoDate(dateRange.from) : addDays(t, -29);
    const to = dateRange?.to ? isoDate(dateRange.to) : from;
    return from <= to ? { from, to } : { from: to, to: from };
  }, [dateRange]);

  const generate = useCallback(async (type: ReportType, pageNo: number) => {
    setLoading(true);
    setError(null);
    const { from, to } = range;
    try {
      const out: Loaded = { type, from, to };
      const results: ReportResult<unknown>[] = [];
      if (type === "sales" || type === "profit") {
        const [p, t] = await Promise.all([reportPeriod(from, to, filterStoreId), reportTrend(from, to, filterStoreId, grainFor(from, to))]);
        results.push(p, t);
        if (p.status === "ok") out.period = p.data;
        if (t.status === "ok") out.trend = t.data;
      } else if (type === "product") {
        const r = await reportProducts(from, to, filterStoreId, { limit: PAGE_SIZE, offset: pageNo * PAGE_SIZE });
        results.push(r);
        if (r.status === "ok") out.products = r.data;
      } else if (type === "customer") {
        const r = await reportCustomers(from, to, filterStoreId, { limit: PAGE_SIZE, offset: pageNo * PAGE_SIZE });
        results.push(r);
        if (r.status === "ok") out.customers = r.data;
      } else {
        const [e, p] = await Promise.all([reportExpenses(from, to, filterStoreId), reportPeriod(from, to, filterStoreId)]);
        results.push(e, p);
        if (e.status === "ok") out.expenses = e.data;
        if (p.status === "ok") out.period = p.data;
      }
      if (results.some((r) => r.status === "missing")) { setMissing(true); return; }
      const failed = results.find((r) => r.status === "error") as { status: "error"; error: unknown } | undefined;
      if (failed) { setError(failed.error); return; }
      setLoaded(out);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [range, filterStoreId]);

  // Runs when the page opens and when the report type, page or store changes.
  // Dates apply when Generate is pressed, so picking a range doesn't fire a query per click.
  useEffect(() => { generate(reportType, page); }, [reportType, page, filterStoreId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (missing) {
    return (
      <Layout>
        <Alert className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>These reports are approximate</AlertTitle>
          <AlertDescription>
            Accurate reports need a one-time database update (the reports part of dailykart-updates.sql). Until it is run,
            profit uses today's purchase prices, includes GST and ignores returns, and busy months may stop at 1,000 bills.
          </AlertDescription>
        </Alert>
        <LegacyReports />
      </Layout>
    );
  }

  const storeName = filterStoreId ? stores.find((s) => s.id === filterStoreId)?.name ?? "One store" : "All stores";
  const view = loaded && loaded.type === reportType ? loaded : null;

  const exportRows = (): { name: string; rows: Record<string, unknown>[] } | null => {
    if (!view) return null;
    if ((view.type === "sales" || view.type === "profit") && view.trend) {
      return {
        name: view.type,
        rows: view.trend.map((r) => view.type === "sales"
          ? { period: r.bucket, bills: r.bills, gross_sales: r.gross_sales, discounts: r.discounts, returns: r.returns, net_sales: r.net_sales, gst: r.tax, total_billed: r.billed_total }
          : { period: r.bucket, net_sales: r.net_sales, cost_of_goods_sold: r.cogs, gross_profit: r.gross_profit, expenses: r.expenses }),
      };
    }
    if (view.type === "product" && view.products) {
      return {
        name: "products",
        rows: view.products.rows.map((r) => ({
          product: r.name, sku: r.sku, barcode: r.barcode, category: r.category, units_sold: r.units, sales_ex_gst: r.revenue,
          returned_qty: r.returned_qty, returns_ex_gst: r.returned_value, net_sales: r.net_revenue, cost: r.cogs, gross_profit: r.profit,
          margin_pct: r.margin, stock_now: r.stock_quantity, selling_price: r.price, mrp: r.mrp,
        })),
      };
    }
    if (view.type === "customer" && view.customers) {
      return {
        name: "customers",
        rows: view.customers.rows.map((r) => ({
          customer: r.name, phone: r.phone, bills: r.bills, spent: r.spend, refunds: r.refunds, net_spent: r.net_spend,
          avg_bill: r.avg_bill, new_in_period: r.is_new ? "yes" : "no", due_now: r.due,
        })),
      };
    }
    if (view.type === "expense" && view.expenses) {
      return { name: "expenses", rows: view.expenses.by_category.map((r) => ({ category: r.category, entries: r.count, amount: r.amount })) };
    }
    return null;
  };

  const doExport = () => {
    const e = exportRows();
    if (!e || !view) return;
    const paged = view.type === "product" || view.type === "customer";
    downloadCsv(`dailykart-${e.name}-${view.from}-to-${view.to}.csv`, e.rows, [
      `DailyKart · ${TITLES[view.type].title}`,
      `Dates: ${view.from} to ${view.to} (India time)`,
      `Store: ${storeName}`,
      `Amounts in INR${view.type === "sales" || view.type === "profit" || view.type === "product" ? "; sales and profit without GST" : ""}`,
      ...(paged ? [`Page ${page + 1} (rows ${page * PAGE_SIZE + 1} to ${page * PAGE_SIZE + e.rows.length})`] : []),
      `Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
    ]);
  };

  const canExport = !!exportRows()?.rows.length;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Reports</h1>
            <p className="text-muted-foreground">{TITLES[reportType].about}</p>
          </div>
          <Button onClick={doExport} className="gap-2" variant="outline" disabled={!canExport || loading}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5" />
              Report configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="flex gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium mb-2 block">Report type</label>
              <Select value={reportType} onValueChange={(v) => { setPage(0); setReportType(v as ReportType); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TITLES) as ReportType[]).map((k) => <SelectItem key={k} value={k}>{TITLES[k].title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[260px]">
              <label className="text-sm font-medium mb-2 block">Dates</label>
              <DatePickerWithRange date={dateRange} setDate={setDateRange} />
            </div>
            <div className="flex items-end">
              <Button onClick={() => { setPage(0); generate(reportType, 0); }} disabled={loading}>
                {loading ? "Generating..." : "Generate report"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {error ? (
          <Card><CardContent><ErrorState compact title={friendlyError(error, "Couldn't load this report").title} description={friendlyError(error, "Couldn't load this report").description} onRetry={() => generate(reportType, page)} /></CardContent></Card>
        ) : !view || loading ? (
          <div className="space-y-4"><CardGridSkeleton count={4} /><ChartSkeleton /></div>
        ) : (
          <ReportBody view={view} page={page} setPage={setPage} />
        )}
      </div>
    </Layout>
  );
}

function Pager({ page, total, setPage }: { page: number; total: number; setPage: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex items-center justify-between gap-2 pt-3 text-sm">
      <span className="text-muted-foreground">{total.toLocaleString("en-IN")} rows · page {page + 1} of {pages}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
        <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

function ReportBody({ view, page, setPage }: { view: Loaded; page: number; setPage: (n: number) => void }) {
  const rangeText = view.from === view.to ? view.from : `${view.from} to ${view.to}`;

  if (view.type === "sales" && view.period && view.trend) {
    const p = view.period;
    const data = view.trend.map((r) => ({ ...r, label: fmtBucket(r.bucket) }));
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi k="gross_sales" value={inr(p.gross_sales)} />
          <Kpi k="discounts" value={inr(p.discounts)} />
          <Kpi k="returns" value={inr(p.returns)} />
          <Kpi k="net_sales" value={inr(p.net_sales)} />
          <Kpi k="gst_collected" value={inr(p.gst_collected)} />
          <Kpi k="bills" value={p.bills.toLocaleString("en-IN")} />
          <Kpi k="avg_bill" value={p.avg_bill === null ? "—" : inr(p.avg_bill)} />
          <Kpi k="credit_sales" value={inr(p.credit_sales)} />
        </div>
        {p.bills === 0 && p.returns_count === 0 ? (
          <Card><CardContent><EmptyState title="No sales in these dates" description={`Nothing was billed from ${rangeText}.`} /></CardContent></Card>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Net sales and bills</CardTitle>
                <CardDescription>Net sales (without GST) as bars, number of bills as the line. India time.</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={data} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis yAxisId="amt" tickFormatter={(v) => inrShort(Number(v))} />
                    <YAxis yAxisId="bills" orientation="right" allowDecimals={false} />
                    <Tooltip formatter={(v, name) => (name === "Bills" ? [v, name] : [inr(Number(v)), name])} />
                    <Legend />
                    <Bar yAxisId="amt" dataKey="net_sales" name="Net sales" fill="hsl(var(--primary))" />
                    <Line yAxisId="bills" dataKey="bills" name="Bills" stroke="hsl(var(--accent))" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Money received</CardTitle>
                <CardDescription>Udhaar given is not money received; udhaar paid back is.</CardDescription></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Method</TableHead><TableHead className="text-right">On bills</TableHead><TableHead className="text-right">Udhaar paid back</TableHead><TableHead className="text-right">Refunded</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {([["Cash", p.collect_cash, p.khata_cash, p.refund_cash], ["UPI", p.collect_upi, p.khata_upi, p.refund_upi],
                       ["Card", p.collect_card, p.khata_card, p.refund_card], ["Bank", p.collect_bank, p.khata_bank, 0]] as const).map(([m, a, b, c]) => (
                      <TableRow key={m}><TableCell>{m}</TableCell><TableCell className="text-right">{inr(a, 2)}</TableCell><TableCell className="text-right">{inr(b, 2)}</TableCell><TableCell className="text-right">{inr(c, 2)}</TableCell></TableRow>
                    ))}
                    <TableRow><TableCell>Udhaar (khata)</TableCell><TableCell className="text-right text-muted-foreground">{inr(p.credit_sales, 2)} given</TableCell><TableCell /><TableCell className="text-right">{inr(p.refund_khata, 2)}</TableCell></TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <TrendTable rows={data} kind="sales" />
          </>
        )}
      </div>
    );
  }

  if (view.type === "profit" && view.period && view.trend) {
    const p = view.period;
    const data = view.trend.map((r) => ({ ...r, label: fmtBucket(r.bucket) }));
    const lines: [string, number, boolean?][] = [
      ["Gross sales (without GST)", p.gross_sales], ["Less discounts", -p.discounts], ["Less sales returns", -p.returns],
      ["Net sales", p.net_sales, true],
      ...(p.cost_missing_value > 0 ? [["Less sales with no saved cost", -p.cost_missing_value] as [string, number]] : []),
      ["Less cost of goods sold", -p.cogs], ["Gross profit", p.gross_profit, true],
      ["Less expenses", -p.expenses], ["Less stock written off", -p.stock_written_off],
      ...(p.other_income ? [["Add other income", p.other_income] as [string, number]] : []),
      ...(p.other_expense ? [["Less other expenses (journals)", -p.other_expense] as [string, number]] : []),
      ["Net profit", p.net_profit, true],
    ];
    return (
      <div className="space-y-4">
        {p.cost_missing_lines > 0 && (
          <Alert><AlertTriangle className="h-4 w-4" /><AlertTitle>{p.cost_missing_lines} bill lines have no saved cost</AlertTitle><AlertDescription>{COST_MISSING_NOTE}</AlertDescription></Alert>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi k="net_sales" value={inr(p.net_sales)} />
          <Kpi k="cogs" value={inr(p.cogs)} />
          <Kpi k="gross_profit" value={inr(p.gross_profit)} tone={p.gross_profit < 0 ? "bad" : undefined} />
          <Kpi k="gross_margin" value={pct(p.gross_margin)} />
          <Kpi k="expenses" value={inr(p.expenses)} />
          <Kpi k="stock_written_off" value={inr(p.stock_written_off)} />
          <Kpi k="net_profit" value={inr(p.net_profit)} tone={p.net_profit < 0 ? "bad" : "good"} />
          <Kpi k="purchases_total" value={inr(p.purchases_total)} />
        </div>
        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-base">Profit &amp; loss statement</CardTitle><CardDescription>{rangeText}, without GST</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  {lines.map(([label, v, strong]) => (
                    <TableRow key={label} className={strong ? "font-semibold bg-muted/40" : ""}>
                      <TableCell>{label}</TableCell><TableCell className="text-right">{inr(v, 2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground mt-2">Purchases ({inr(p.purchases_total)}) go into stock and are not subtracted; only the cost of what was sold is.</p>
            </CardContent>
          </Card>
          <Card className="lg:col-span-3">
            <CardHeader className="pb-2"><CardTitle className="text-base">Net sales, cost and gross profit</CardTitle><CardDescription>India time, without GST</CardDescription></CardHeader>
            <CardContent>
              {p.bills === 0 && p.returns_count === 0 ? <EmptyState title="No sales in these dates" /> : (
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis tickFormatter={(v) => inrShort(Number(v))} />
                    <Tooltip formatter={(v, name) => [inr(Number(v)), name]} />
                    <Legend />
                    <Bar dataKey="net_sales" name="Net sales" fill="hsl(var(--primary))" />
                    <Bar dataKey="cogs" name="Cost of goods sold" fill="hsl(var(--muted-foreground))" />
                    <Line dataKey="gross_profit" name="Gross profit" stroke="hsl(var(--success))" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
        <TrendTable rows={data} kind="profit" />
      </div>
    );
  }

  if (view.type === "product" && view.products) {
    const pr = view.products;
    if (pr.total === 0) return <Card><CardContent><EmptyState title="No products sold in these dates" /></CardContent></Card>;
    const top = page === 0 ? pr.rows.slice(0, 10).map((r) => ({ name: r.name.length > 18 ? r.name.slice(0, 17) + "…" : r.name, net: r.net_revenue, profit: r.profit ?? 0 })) : [];
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi k="Products sold" value={pr.total.toLocaleString("en-IN")} />
          <Kpi k="Units sold" value={pr.totals.units.toLocaleString("en-IN")} />
          <Kpi k="net_sales" value={inr(pr.totals.net_revenue)} />
          <Kpi k="gross_profit" value={inr(pr.totals.profit)} />
        </div>
        {top.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Top 10 products by net sales</CardTitle><CardDescription>Without GST, after returns</CardDescription></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={Math.max(220, top.length * 32)}>
                <BarChart data={top} layout="vertical" margin={{ left: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={(v) => inrShort(Number(v))} />
                  <YAxis type="category" dataKey="name" width={120} />
                  <Tooltip formatter={(v, name) => [inr(Number(v)), name]} />
                  <Legend />
                  <Bar dataKey="net" name="Net sales" fill="hsl(var(--primary))" />
                  <Bar dataKey="profit" name="Gross profit" fill="hsl(var(--success))" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Every product sold</CardTitle><CardDescription>Highest net sales first. Amounts without GST.</CardDescription></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Product</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Returned</TableHead><TableHead className="text-right">Net sales</TableHead>
                <TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Margin</TableHead><TableHead className="text-right">Stock now</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {pr.rows.map((r) => (
                  <TableRow key={r.product_id}>
                    <TableCell><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{[r.sku, r.barcode].filter(Boolean).join(" · ")}</div></TableCell>
                    <TableCell>{r.category || "—"}</TableCell>
                    <TableCell className="text-right">{r.units}</TableCell>
                    <TableCell className="text-right">{r.returned_qty || "—"}</TableCell>
                    <TableCell className="text-right">{inr(r.net_revenue, 2)}</TableCell>
                    <TableCell className="text-right">{r.cogs === null ? "not saved" : inr(r.cogs, 2)}</TableCell>
                    <TableCell className={`text-right ${(r.profit ?? 0) < 0 ? "text-destructive" : ""}`}>{r.profit === null ? "—" : inr(r.profit, 2)}</TableCell>
                    <TableCell className="text-right">{pct(r.margin)}</TableCell>
                    <TableCell className="text-right">{r.stock_quantity ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager page={page} total={pr.total} setPage={setPage} />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (view.type === "customer" && view.customers) {
    const c = view.customers;
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi k="Customers who bought" value={c.total.toLocaleString("en-IN")} />
          <Kpi k="New customers" value={c.new_customers.toLocaleString("en-IN")} />
          <Kpi k="Bought more than once" value={c.repeat_customers.toLocaleString("en-IN")} />
          <Kpi k="Walk-in bills" value={c.walk_in_bills.toLocaleString("en-IN")} />
        </div>
        {c.total === 0 ? (
          <Card><CardContent><EmptyState title="No named customers bought in these dates" description="Bills without a customer are counted as walk-in." /></CardContent></Card>
        ) : (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Customers in this period</CardTitle><CardDescription>Highest spend first. Spend includes GST; "New" means their first ever bill falls in these dates.</CardDescription></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Customer</TableHead><TableHead className="text-right">Bills</TableHead><TableHead className="text-right">Spent</TableHead>
                  <TableHead className="text-right">Refunds</TableHead><TableHead className="text-right">Avg bill</TableHead>
                  <TableHead className="text-right">Owes now</TableHead><TableHead>Last bill</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {c.rows.map((r) => (
                    <TableRow key={r.customer_id}>
                      <TableCell><div className="font-medium">{r.name}{r.is_new && <span className="ml-2 text-xs rounded bg-primary/10 text-primary px-1.5 py-0.5">New</span>}</div><div className="text-xs text-muted-foreground">{r.phone}</div></TableCell>
                      <TableCell className="text-right">{r.bills}</TableCell>
                      <TableCell className="text-right">{inr(r.net_spend, 2)}</TableCell>
                      <TableCell className="text-right">{r.refunds ? inr(r.refunds, 2) : "—"}</TableCell>
                      <TableCell className="text-right">{r.avg_bill === null ? "—" : inr(r.avg_bill, 2)}</TableCell>
                      <TableCell className={`text-right ${r.due > 0 ? "text-destructive" : ""}`}>{r.due ? inr(r.due, 2) : "—"}</TableCell>
                      <TableCell>{r.last_at ? new Date(r.last_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pager page={page} total={c.total} setPage={setPage} />
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  if (view.type === "expense" && view.expenses) {
    const e = view.expenses;
    const share = view.period && view.period.net_sales > 0 ? (e.total * 100) / view.period.net_sales : null;
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi k="expenses" value={inr(e.total)} />
          <Kpi k="Entries" value={e.count.toLocaleString("en-IN")} />
          <Kpi k="Share of net sales" value={pct(share)} />
          <Kpi k="Waiting for approval" value={e.pending_count ? `${e.pending_count} · ${inr(e.pending_total)}` : "None"} />
        </div>
        {e.count === 0 ? (
          <Card><CardContent><EmptyState title="No approved expenses in these dates" /></CardContent></Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">By category</CardTitle><CardDescription>Approved expenses only</CardDescription></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={e.by_category} dataKey="amount" nameKey="category" innerRadius={60} outerRadius={110}>
                      {e.by_category.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v, name) => [inr(Number(v)), name]} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Details</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Category</TableHead><TableHead className="text-right">Entries</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Share</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {e.by_category.map((r) => (
                      <TableRow key={r.category}><TableCell>{r.category}</TableCell><TableCell className="text-right">{r.count}</TableCell><TableCell className="text-right">{inr(r.amount, 2)}</TableCell><TableCell className="text-right">{pct((r.amount * 100) / e.total)}</TableCell></TableRow>
                    ))}
                  </TableBody>
                  <TableFooter><TableRow><TableCell>Total</TableCell><TableCell className="text-right">{e.count}</TableCell><TableCell className="text-right">{inr(e.total, 2)}</TableCell><TableCell /></TableRow></TableFooter>
                </Table>
                <p className="text-sm font-medium mt-4 mb-1">Paid by</p>
                <Table>
                  <TableBody>
                    {e.by_method.map((r) => (
                      <TableRow key={r.method}><TableCell className="capitalize">{r.method}</TableCell><TableCell className="text-right">{r.count}</TableCell><TableCell className="text-right">{inr(r.amount, 2)}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    );
  }

  return null;
}

function TrendTable({ rows, kind }: { rows: (TrendRow & { label: string })[]; kind: "sales" | "profit" }) {
  const shown = rows.filter((r) => r.bills || r.returns || r.expenses);
  if (shown.length === 0) return null;
  const sum = (k: keyof TrendRow) => shown.reduce((a, r) => a + Number(r[k] || 0), 0);
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Period by period</CardTitle><CardDescription>Only periods with activity are listed.</CardDescription></CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            {kind === "sales" ? (
              <TableRow><TableHead>Period</TableHead><TableHead className="text-right">Bills</TableHead><TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Discounts</TableHead><TableHead className="text-right">Returns</TableHead><TableHead className="text-right">Net sales</TableHead><TableHead className="text-right">GST</TableHead><TableHead className="text-right">Total billed</TableHead></TableRow>
            ) : (
              <TableRow><TableHead>Period</TableHead><TableHead className="text-right">Net sales</TableHead><TableHead className="text-right">Cost of goods</TableHead><TableHead className="text-right">Gross profit</TableHead><TableHead className="text-right">Expenses</TableHead></TableRow>
            )}
          </TableHeader>
          <TableBody>
            {shown.map((r) => kind === "sales" ? (
              <TableRow key={r.bucket}><TableCell>{r.label}</TableCell><TableCell className="text-right">{r.bills}</TableCell><TableCell className="text-right">{inr(r.gross_sales, 2)}</TableCell><TableCell className="text-right">{inr(r.discounts, 2)}</TableCell><TableCell className="text-right">{inr(r.returns, 2)}</TableCell><TableCell className="text-right">{inr(r.net_sales, 2)}</TableCell><TableCell className="text-right">{inr(r.tax, 2)}</TableCell><TableCell className="text-right">{inr(r.billed_total, 2)}</TableCell></TableRow>
            ) : (
              <TableRow key={r.bucket}><TableCell>{r.label}</TableCell><TableCell className="text-right">{inr(r.net_sales, 2)}</TableCell><TableCell className="text-right">{inr(r.cogs, 2)}</TableCell><TableCell className="text-right">{inr(r.gross_profit, 2)}</TableCell><TableCell className="text-right">{inr(r.expenses, 2)}</TableCell></TableRow>
            ))}
          </TableBody>
          <TableFooter>
            {kind === "sales" ? (
              <TableRow><TableCell>Total</TableCell><TableCell className="text-right">{sum("bills")}</TableCell><TableCell className="text-right">{inr(sum("gross_sales"), 2)}</TableCell><TableCell className="text-right">{inr(sum("discounts"), 2)}</TableCell><TableCell className="text-right">{inr(sum("returns"), 2)}</TableCell><TableCell className="text-right">{inr(sum("net_sales"), 2)}</TableCell><TableCell className="text-right">{inr(sum("tax"), 2)}</TableCell><TableCell className="text-right">{inr(sum("billed_total"), 2)}</TableCell></TableRow>
            ) : (
              <TableRow><TableCell>Total</TableCell><TableCell className="text-right">{inr(sum("net_sales"), 2)}</TableCell><TableCell className="text-right">{inr(sum("cogs"), 2)}</TableCell><TableCell className="text-right">{inr(sum("gross_profit"), 2)}</TableCell><TableCell className="text-right">{inr(sum("expenses"), 2)}</TableCell></TableRow>
            )}
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}
