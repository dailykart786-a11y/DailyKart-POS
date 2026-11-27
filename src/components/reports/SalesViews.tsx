// Sales reports. All figures from report_period / report_trend / report_breakdown.
import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inrShort } from "@/lib/dashboard";
import {
  BreakdownBy, BreakdownRow, Grain, PeriodReport, ReportResult, TrendRow,
  grainFor, reportBreakdown, reportPayments, reportPeriod, reportPosition, reportTrend,
} from "@/lib/reports/api";
import { dayCount } from "@/lib/reports/dates";
import { ReportCtx, both, csvMeta, csvName, useReportData } from "./context";
import { CHART_COLORS, Kpi, Loaded, METHOD_LABEL, NoData, Section, fmtBucket, inr, num, pct } from "./shared";

const R = "text-right";

/** Lets the owner regroup a trend by day, week, month or year. */
export function GrainPicker({ value, onChange, days }: { value: Grain; onChange: (g: Grain) => void; days: number }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Grain)}>
      <SelectTrigger className="h-8 w-[110px]" aria-label="Group by"><SelectValue /></SelectTrigger>
      <SelectContent>
        {days <= 400 && <SelectItem value="day">By day</SelectItem>}
        <SelectItem value="week">By week</SelectItem>
        <SelectItem value="month">By month</SelectItem>
        <SelectItem value="year">By year</SelectItem>
      </SelectContent>
    </Select>
  );
}

function useGrain(ctx: ReportCtx) {
  const days = dayCount(ctx.range);
  const [grain, setGrain] = useState<Grain | null>(null);
  const g = grain && !(grain === "day" && days > 400) ? grain : grainFor(ctx.range.from, ctx.range.to);
  return { grain: g, setGrain, days };
}

// ---------------------------------------------------------------- summary
export function SalesSummary({ ctx }: { ctx: ReportCtx }) {
  const { grain, setGrain, days } = useGrain(ctx);
  const state = useReportData(async (): Promise<ReportResult<{ p: PeriodReport; prev: PeriodReport | null; t: TrendRow[]; pt: TrendRow[] | null }>> => {
    const [p, t] = await Promise.all([
      both(reportPeriod(ctx.range.from, ctx.range.to, ctx.storeId), ctx.compare ? reportPeriod(ctx.compare.from, ctx.compare.to, ctx.storeId) : null),
      both(reportTrend(ctx.range.from, ctx.range.to, ctx.storeId, grain), ctx.compare ? reportTrend(ctx.compare.from, ctx.compare.to, ctx.storeId, grain) : null),
    ]);
    if (p.status !== "ok") return p;
    if (t.status !== "ok") return t;
    return { status: "ok", data: { p: p.data.a, prev: p.data.b, t: t.data.a, pt: t.data.b } };
  }, [ctx.run, ctx.storeId, grain], ctx.onMissing);

  return (
    <Loaded state={state} kpis={8}>
      {({ p, prev, t, pt }) => {
        const cmp = (n: number | null | undefined) => (prev ? n : undefined);
        // Line the comparison period up bucket by bucket (1st day with 1st day, and so on)
        const data = t.map((r, i) => ({ ...r, label: fmtBucket(r.bucket, grain), prev_net: pt?.[i]?.net_sales }));
        const rows = t.filter((r) => r.bills || r.returns);
        const sum = (k: keyof TrendRow) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi k="gross_sales" value={inr(p.gross_sales)} now={p.gross_sales} before={cmp(prev?.gross_sales)} compareLabel={ctx.compareLabel} />
              <Kpi k="discounts" value={inr(p.discounts)} now={p.discounts} before={cmp(prev?.discounts)} lowerIsBetter compareLabel={ctx.compareLabel} />
              <Kpi k="returns" value={inr(p.returns)} now={p.returns} before={cmp(prev?.returns)} lowerIsBetter compareLabel={ctx.compareLabel} />
              <Kpi k="net_sales" value={inr(p.net_sales)} now={p.net_sales} before={cmp(prev?.net_sales)} compareLabel={ctx.compareLabel} />
              <Kpi k="gst_collected" value={inr(p.gst_collected)} now={p.gst_collected} before={cmp(prev?.gst_collected)} compareLabel={ctx.compareLabel} />
              <Kpi k="billed_total" value={inr(p.billed_total)} now={p.billed_total} before={cmp(prev?.billed_total)} compareLabel={ctx.compareLabel} />
              <Kpi label="Units sold" value={num(p.units_sold)} now={p.units_sold} before={cmp(prev?.units_sold)} money={false} compareLabel={ctx.compareLabel} />
              <Kpi label="Named customers" value={num(p.buyers)} now={p.buyers} before={cmp(prev?.buyers)} money={false} compareLabel={ctx.compareLabel}
                hint="walk-ins not counted" />
            </div>
            {p.bills === 0 && p.returns_count === 0 ? (
              <NoData title="No sales in these dates" description="Pick other dates, or check the store filter at the top." />
            ) : (
              <>
                <Section title="Net sales trend" description={`Net sales without GST${prev ? `, with ${ctx.compareLabel} as a dotted line` : ""}. Bills on the right axis.`}
                  actions={<GrainPicker value={grain} onChange={setGrain} days={days} />}>
                  <ResponsiveContainer width="100%" height={320}>
                    <ComposedChart data={data} margin={{ left: 4, right: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis yAxisId="amt" tickFormatter={(v) => inrShort(Number(v))} tick={{ fontSize: 12 }} width={56}
                        label={{ value: "₹ net sales", angle: -90, position: "insideLeft", fontSize: 11, offset: 0 }} />
                      <YAxis yAxisId="bills" orientation="right" allowDecimals={false} tick={{ fontSize: 12 }} width={36}
                        label={{ value: "Bills", angle: 90, position: "insideRight", fontSize: 11 }} />
                      <Tooltip formatter={(v, name) => (name === "Bills" ? [v, name] : [inr(Number(v)), name])} />
                      <Legend />
                      <Bar yAxisId="amt" dataKey="net_sales" name="Net sales" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                      {prev && <Line yAxisId="amt" dataKey="prev_net" name={`Net sales, ${ctx.compareLabel}`} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" dot={false} />}
                      <Line yAxisId="bills" dataKey="bills" name="Bills" stroke="hsl(var(--warning))" dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </Section>
                <Section title="Period by period" description="Only periods with sales or returns are listed."
                  csv={{ filename: csvName(ctx, `sales-by-${grain}`), meta: csvMeta(ctx, "Sales summary", ["Sales without GST unless noted"]),
                    rows: rows.map((r) => ({ period: r.bucket, bills: r.bills, gross_sales: r.gross_sales, discounts: r.discounts, returns: r.returns, net_sales: r.net_sales, gst: r.tax, total_billed_incl_gst: r.billed_total })) }}>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Period</TableHead><TableHead className={R}>Bills</TableHead><TableHead className={R}>Gross</TableHead>
                      <TableHead className={R}>Discounts</TableHead><TableHead className={R}>Returns</TableHead><TableHead className={R}>Net sales</TableHead>
                      <TableHead className={R}>GST</TableHead><TableHead className={R}>Total billed</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.bucket}>
                          <TableCell className="whitespace-nowrap">{fmtBucket(r.bucket, grain)}</TableCell><TableCell className={R}>{r.bills}</TableCell>
                          <TableCell className={R}>{inr(r.gross_sales, 2)}</TableCell><TableCell className={R}>{inr(r.discounts, 2)}</TableCell>
                          <TableCell className={R}>{inr(r.returns, 2)}</TableCell><TableCell className={R}>{inr(r.net_sales, 2)}</TableCell>
                          <TableCell className={R}>{inr(r.tax, 2)}</TableCell><TableCell className={R}>{inr(r.billed_total, 2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter><TableRow className="font-semibold">
                      <TableCell>Total</TableCell><TableCell className={R}>{sum("bills")}</TableCell><TableCell className={R}>{inr(sum("gross_sales"), 2)}</TableCell>
                      <TableCell className={R}>{inr(sum("discounts"), 2)}</TableCell><TableCell className={R}>{inr(sum("returns"), 2)}</TableCell>
                      <TableCell className={R}>{inr(sum("net_sales"), 2)}</TableCell><TableCell className={R}>{inr(sum("tax"), 2)}</TableCell>
                      <TableCell className={R}>{inr(sum("billed_total"), 2)}</TableCell>
                    </TableRow></TableFooter>
                  </Table>
                </Section>
              </>
            )}
          </div>
        );
      }}
    </Loaded>
  );
}

// ---------------------------------------------------------------- busy hours
export function SalesHourly({ ctx }: { ctx: ReportCtx }) {
  const tooLong = dayCount(ctx.range) > 400;
  const state = useReportData(
    () => (tooLong ? Promise.resolve({ status: "ok" as const, data: [] as TrendRow[] }) : reportTrend(ctx.range.from, ctx.range.to, ctx.storeId, "hour")),
    [ctx.run, ctx.storeId], ctx.onMissing,
  );
  if (tooLong) return <NoData title="Pick a shorter range" description="Busy hours work for up to about 13 months at a time." />;
  return (
    <Loaded state={state} kpis={3}>
      {(rows) => {
        const total = rows.reduce((a, r) => a + r.bills, 0);
        if (total === 0) return <NoData title="No bills in these dates" />;
        const top = [...rows].sort((a, b) => b.net_sales - a.net_sales).slice(0, 3).filter((r) => r.bills > 0);
        const open = rows.filter((r) => r.bills > 0);
        const first = open[0]?.bucket, last = open[open.length - 1]?.bucket;
        const data = rows.filter((r) => r.bucket >= (first ?? "00:00") && r.bucket <= (last ?? "23:00"));
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Kpi label="Busiest hour (sales)" value={top[0] ? `${top[0].bucket}` : "—"} hint={top[0] ? `${inr(top[0].net_sales)} · ${top[0].bills} bills` : undefined} />
              <Kpi label="First and last bill hour" value={first && last ? `${first} – ${last}` : "—"} />
              <Kpi label="Bills in these dates" value={num(total)} />
            </div>
            <Section title="Sales by hour of day" description="All days in the range added together, India time. Bars are net sales without GST; the line is bills."
              csv={{ filename: csvName(ctx, "sales-by-hour"), meta: csvMeta(ctx, "Busy hours"), rows: rows.map((r) => ({ hour: r.bucket, bills: r.bills, net_sales: r.net_sales, total_billed_incl_gst: r.billed_total })) }}>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="amt" tickFormatter={(v) => inrShort(Number(v))} tick={{ fontSize: 12 }} width={56} />
                  <YAxis yAxisId="bills" orientation="right" allowDecimals={false} tick={{ fontSize: 12 }} width={36} />
                  <Tooltip formatter={(v, name) => (name === "Bills" ? [v, name] : [inr(Number(v)), name])} />
                  <Legend />
                  <Bar yAxisId="amt" dataKey="net_sales" name="Net sales" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="bills" dataKey="bills" name="Bills" stroke="hsl(var(--warning))" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
              {top.length > 0 && <p className="text-sm text-muted-foreground mt-2">Peak hours: {top.map((r) => r.bucket).join(", ")}.</p>}
            </Section>
          </div>
        );
      }}
    </Loaded>
  );
}

// ---------------------------------------------------------------- category / cashier / weekday
function BreakdownView({ ctx, by, title, about, profit, slug }: { ctx: ReportCtx; by: BreakdownBy; title: string; about: string; profit?: boolean; slug: string }) {
  const state = useReportData(() => reportBreakdown(ctx.range.from, ctx.range.to, ctx.storeId, by), [ctx.run, ctx.storeId, by], ctx.onMissing);
  return (
    <Loaded state={state} kpis={0}>
      {(rows) => {
        if (rows.length === 0) return <NoData title="No sales in these dates" />;
        const tot = (k: keyof BreakdownRow) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
        const totNet = tot("net_sales");
        const totNoCost = tot("cost_missing_value");
        const totGp = tot("gross_profit");
        const data = rows.slice(0, by === "weekday" ? 7 : 12).map((r) => ({ ...r, name: r.label.length > 16 ? r.label.slice(0, 15) + "…" : r.label }));
        const showBills = by !== "category";
        return (
          <div className="space-y-4">
            <Section title={title} description={about}>
              <ResponsiveContainer width="100%" height={by === "weekday" ? 280 : Math.max(220, data.length * 34)}>
                {by === "weekday" ? (
                  <BarChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" /><YAxis tickFormatter={(v) => inrShort(Number(v))} width={56} />
                    <Tooltip formatter={(v, name) => [inr(Number(v)), name]} /><Legend />
                    <Bar dataKey="net_sales" name="Net sales" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                    {profit && <Bar dataKey="gross_profit" name="Gross profit" fill="hsl(var(--success))" radius={[3, 3, 0, 0]} />}
                  </BarChart>
                ) : (
                  <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => inrShort(Number(v))} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v, name) => [inr(Number(v)), name]} /><Legend />
                    <Bar dataKey="net_sales" name="Net sales" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} />
                    {profit && <Bar dataKey="gross_profit" name="Gross profit" fill="hsl(var(--success))" radius={[0, 3, 3, 0]} />}
                  </BarChart>
                )}
              </ResponsiveContainer>
              {rows.length > data.length && <p className="text-xs text-muted-foreground mt-1">Chart shows the top {data.length}; the table lists all {rows.length}.</p>}
            </Section>
            <Section title="Details" description="Amounts without GST. Returns are counted on the day they came back."
              csv={{ filename: csvName(ctx, slug), meta: csvMeta(ctx, title, ["Sales and profit without GST"]),
                rows: rows.map((r) => ({ [by]: r.label, bills: r.bills, units: r.units, gross_sales: r.gross_sales, discounts: r.discounts, returns: r.returns,
                  net_sales: r.net_sales, share_pct: totNet ? Math.round((r.net_sales * 1000) / totNet) / 10 : "", cost: r.cogs,
                  sales_without_saved_cost: r.cost_missing_value, gross_profit: r.gross_profit, margin_pct: r.gross_margin ?? "" })) }}>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>{by === "category" ? "Category" : by === "cashier" ? "Staff" : "Day"}</TableHead>
                  {showBills && <TableHead className={R}>Bills</TableHead>}
                  <TableHead className={R}>Units</TableHead><TableHead className={R}>Discounts</TableHead><TableHead className={R}>Returns</TableHead>
                  <TableHead className={R}>Net sales</TableHead><TableHead className={R}>Share</TableHead>
                  {showBills && <TableHead className={R}>Avg bill</TableHead>}
                  <TableHead className={R}>Gross profit</TableHead><TableHead className={R}>Margin</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="font-medium">{r.label}</TableCell>
                      {showBills && <TableCell className={R}>{r.bills}</TableCell>}
                      <TableCell className={R}>{num(r.units)}</TableCell><TableCell className={R}>{inr(r.discounts, 2)}</TableCell>
                      <TableCell className={R}>{r.returns ? `${inr(r.returns, 2)} (${r.return_count})` : "—"}</TableCell>
                      <TableCell className={R}>{inr(r.net_sales, 2)}</TableCell><TableCell className={R}>{totNet ? pct((r.net_sales * 100) / totNet) : "—"}</TableCell>
                      {showBills && <TableCell className={R}>{inr(r.avg_bill, 2)}</TableCell>}
                      <TableCell className={`${R} ${r.gross_profit < 0 ? "text-destructive" : ""}`}>{inr(r.gross_profit, 2)}</TableCell>
                      <TableCell className={R}>{pct(r.gross_margin)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter><TableRow className="font-semibold">
                  <TableCell>Total</TableCell>
                  {showBills && <TableCell className={R}>{tot("bills")}</TableCell>}
                  <TableCell className={R}>{num(Math.round(tot("units") * 1000) / 1000)}</TableCell><TableCell className={R}>{inr(tot("discounts"), 2)}</TableCell>
                  <TableCell className={R}>{inr(tot("returns"), 2)}</TableCell><TableCell className={R}>{inr(totNet, 2)}</TableCell><TableCell className={R}>100%</TableCell>
                  {showBills && <TableCell />}
                  <TableCell className={R}>{inr(totGp, 2)}</TableCell>
                  <TableCell className={R}>{totNet - totNoCost > 0 ? pct((totGp * 100) / (totNet - totNoCost)) : "—"}</TableCell>
                </TableRow></TableFooter>
              </Table>
              {by === "cashier" && <p className="text-xs text-muted-foreground mt-2">Returns are listed under the staff member who took them back.</p>}
            </Section>
          </div>
        );
      }}
    </Loaded>
  );
}

export const SalesCategory = ({ ctx }: { ctx: ReportCtx }) =>
  <BreakdownView ctx={ctx} by="category" slug="sales-by-category" title="Net sales by category" about="Without GST, after discounts and returns." profit />;
export const SalesCashier = ({ ctx }: { ctx: ReportCtx }) =>
  <BreakdownView ctx={ctx} by="cashier" slug="sales-by-staff" title="Net sales by staff member" about="Who made the bills, without GST." />;
export const SalesWeekday = ({ ctx }: { ctx: ReportCtx }) =>
  <BreakdownView ctx={ctx} by="weekday" slug="sales-by-weekday" title="Net sales by day of the week" about="All Mondays added together, all Tuesdays, and so on." />;
export const ProfitCategory = ({ ctx }: { ctx: ReportCtx }) =>
  <BreakdownView ctx={ctx} by="category" slug="profit-by-category" title="Gross profit by category" about="Net sales and gross profit, without GST." profit />;

// ---------------------------------------------------------------- payments
export function SalesPayments({ ctx }: { ctx: ReportCtx }) {
  const state = useReportData(async () => {
    const r = await both(reportPayments(ctx.range.from, ctx.range.to, ctx.storeId), reportPeriod(ctx.range.from, ctx.range.to, ctx.storeId));
    return r;
  }, [ctx.run, ctx.storeId], ctx.onMissing);
  return (
    <Loaded state={state} kpis={4}>
      {({ a: rows, b: p }) => {
        if (!p || rows.length === 0) return <NoData title="No bills in these dates" />;
        const billed = rows.reduce((a, r) => a + r.amount, 0);
        const received = p.collect_cash + p.collect_upi + p.collect_card + p.collect_bank;
        const khata = p.khata_cash + p.khata_upi + p.khata_card + p.khata_bank;
        const refunds = p.refund_cash + p.refund_upi + p.refund_card;
        const table = [
          ["cash", p.collect_cash, p.khata_cash, p.refund_cash], ["upi", p.collect_upi, p.khata_upi, p.refund_upi],
          ["card", p.collect_card, p.khata_card, p.refund_card], ["bank", p.collect_bank, p.khata_bank, 0],
        ] as const;
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi k="collections" label="Received on bills" value={inr(received)} hint="cash + UPI + card + bank" />
              <Kpi label="Udhaar paid back" value={inr(khata)} hint={`${p.khata_payments} payments`} />
              <Kpi k="credit_sales" value={inr(p.credit_sales)} hint="not money received" />
              <Kpi label="Refunded" value={inr(refunds)} hint={p.refund_khata ? `+ ${inr(p.refund_khata)} to khata` : undefined} />
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <Section title="How bills were paid" description={`${p.split_bills} split bills are counted once in each method they used.`}>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={rows.map((r) => ({ ...r, name: METHOD_LABEL[r.key] ?? r.key }))} dataKey="amount" nameKey="name" innerRadius={60} outerRadius={105} paddingAngle={1}>
                      {rows.map((r, i) => <Cell key={r.key} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v, name) => [`${inr(Number(v))} (${pct((Number(v) * 100) / billed)})`, name]} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </Section>
              <Section title="Money in and out by method" description="Bills include GST. Udhaar given is shown separately; it isn't money received."
                csv={{ filename: csvName(ctx, "payments"), meta: csvMeta(ctx, "Payment methods", ["Amounts include GST"]),
                  rows: [...table.map(([m, a, b, c]) => ({ method: METHOD_LABEL[m], on_bills: a, udhaar_paid_back: b, refunded: c, net_in: Math.round((a + b - c) * 100) / 100 })),
                    { method: "Udhaar (credit) given", on_bills: p.credit_sales, udhaar_paid_back: "", refunded: p.refund_khata, net_in: "" }] }}>
                <Table>
                  <TableHeader><TableRow><TableHead>Method</TableHead><TableHead className={R}>On bills</TableHead><TableHead className={R}>Udhaar paid back</TableHead><TableHead className={R}>Refunded</TableHead><TableHead className={R}>Net in</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {table.map(([m, a, b, c]) => (
                      <TableRow key={m}><TableCell>{METHOD_LABEL[m]}</TableCell><TableCell className={R}>{inr(a, 2)}</TableCell><TableCell className={R}>{inr(b, 2)}</TableCell><TableCell className={R}>{inr(c, 2)}</TableCell><TableCell className={`${R} font-medium`}>{inr(a + b - c, 2)}</TableCell></TableRow>
                    ))}
                    <TableRow className="text-muted-foreground"><TableCell>Udhaar (credit) given</TableCell><TableCell className={R}>{inr(p.credit_sales, 2)}</TableCell><TableCell /><TableCell className={R}>{p.refund_khata ? `${inr(p.refund_khata, 2)} to khata` : "—"}</TableCell><TableCell /></TableRow>
                  </TableBody>
                  <TableFooter><TableRow className="font-semibold"><TableCell>Total received</TableCell><TableCell className={R}>{inr(received, 2)}</TableCell><TableCell className={R}>{inr(khata, 2)}</TableCell><TableCell className={R}>{inr(refunds, 2)}</TableCell><TableCell className={R}>{inr(received + khata - refunds, 2)}</TableCell></TableRow></TableFooter>
                </Table>
              </Section>
            </div>
          </div>
        );
      }}
    </Loaded>
  );
}

// ---------------------------------------------------------------- returns and discounts
export function SalesReturns({ ctx }: { ctx: ReportCtx }) {
  const { grain, setGrain, days } = useGrain(ctx);
  const state = useReportData(async (): Promise<ReportResult<{ p: PeriodReport; prev: PeriodReport | null; t: TrendRow[] }>> => {
    const [p, t] = await Promise.all([
      both(reportPeriod(ctx.range.from, ctx.range.to, ctx.storeId), ctx.compare ? reportPeriod(ctx.compare.from, ctx.compare.to, ctx.storeId) : null),
      reportTrend(ctx.range.from, ctx.range.to, ctx.storeId, grain),
    ]);
    if (p.status !== "ok") return p;
    if (t.status !== "ok") return t;
    return { status: "ok", data: { p: p.data.a, prev: p.data.b, t: t.data } };
  }, [ctx.run, ctx.storeId, grain], ctx.onMissing);
  return (
    <Loaded state={state} kpis={4}>
      {({ p, prev, t }) => {
        const cmp = (n: number | null | undefined) => (prev ? n : undefined);
        const discountRate = p.gross_sales > 0 ? (p.discounts * 100) / p.gross_sales : null;
        const returnRate = p.taxable_sales > 0 ? (p.returns * 100) / p.taxable_sales : null;
        const data = t.map((r) => ({ ...r, label: fmtBucket(r.bucket, grain) }));
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi k="discounts" value={inr(p.discounts)} now={p.discounts} before={cmp(prev?.discounts)} lowerIsBetter compareLabel={ctx.compareLabel} hint={discountRate !== null ? `${discountRate.toFixed(1)}% of gross sales` : undefined} />
              <Kpi k="returns" value={inr(p.returns)} now={p.returns} before={cmp(prev?.returns)} lowerIsBetter compareLabel={ctx.compareLabel} hint={returnRate !== null ? `${returnRate.toFixed(1)}% of sales` : undefined} />
              <Kpi label="Number of returns" value={num(p.returns_count)} now={p.returns_count} before={cmp(prev?.returns_count)} money={false} lowerIsBetter compareLabel={ctx.compareLabel} />
              <Kpi label="GST given back on returns" value={inr(p.gst_on_returns)} />
            </div>
            {p.discounts === 0 && p.returns_count === 0 ? <NoData title="No discounts or returns in these dates" /> : (
              <Section title="Discounts and returns over time" description="Both without GST." actions={<GrainPicker value={grain} onChange={setGrain} days={days} />}
                csv={{ filename: csvName(ctx, "discounts-returns"), meta: csvMeta(ctx, "Returns and discounts", ["Without GST"]),
                  rows: t.filter((r) => r.discounts || r.returns).map((r) => ({ period: r.bucket, gross_sales: r.gross_sales, discounts: r.discounts, returns: r.returns })) }}>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} /><YAxis tickFormatter={(v) => inrShort(Number(v))} width={56} />
                    <Tooltip formatter={(v, name) => [inr(Number(v)), name]} /><Legend />
                    <Bar dataKey="discounts" name="Discounts" stackId="a" fill="hsl(var(--warning))" />
                    <Bar dataKey="returns" name="Returns" stackId="a" fill="hsl(var(--destructive))" />
                  </BarChart>
                </ResponsiveContainer>
              </Section>
            )}
            <p className="text-xs text-muted-foreground">Refunds by method are under Payment methods. A list of each return is coming with the detailed tables (Phase 8).</p>
          </div>
        );
      }}
    </Loaded>
  );
}

// ---------------------------------------------------------------- udhaar sales
export function SalesCredit({ ctx }: { ctx: ReportCtx }) {
  const state = useReportData(() => both(reportPeriod(ctx.range.from, ctx.range.to, ctx.storeId), reportPosition(ctx.storeId)), [ctx.run, ctx.storeId], ctx.onMissing);
  return (
    <Loaded state={state} kpis={4}>
      {({ a: p, b: pos }) => {
        const paid = p.billed_total - p.credit_sales;
        const khata = p.khata_cash + p.khata_upi + p.khata_card + p.khata_bank;
        const data = [{ name: "Paid at the counter", amount: paid }, { name: "Put on khata", amount: p.credit_sales }].filter((d) => d.amount > 0);
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi label="Paid at the counter" value={inr(paid)} hint={p.billed_total ? `${pct((paid * 100) / p.billed_total)} of billed` : undefined} />
              <Kpi k="credit_sales" value={inr(p.credit_sales)} hint={p.billed_total ? `${pct((p.credit_sales * 100) / p.billed_total)} of billed` : undefined} />
              <Kpi label="Udhaar paid back" value={inr(khata)} hint={`${p.khata_payments} payments in these dates`} />
              <Kpi k="customer_outstanding" value={inr(pos?.customer_outstanding)} hint={pos ? `${pos.customers_owing} customers · now` : undefined} />
            </div>
            {data.length === 0 ? <NoData title="No bills in these dates" /> : (
              <Section title="Paid now vs udhaar" description="Billed amounts including GST.">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={data} dataKey="amount" nameKey="name" innerRadius={55} outerRadius={95}>
                      {data.map((d, i) => <Cell key={d.name} fill={CHART_COLORS[i]} />)}
                    </Pie>
                    <Tooltip formatter={(v, name) => [inr(Number(v)), name]} /><Legend />
                  </PieChart>
                </ResponsiveContainer>
              </Section>
            )}
            <p className="text-xs text-muted-foreground">Customer-by-customer dues and ageing (0–7, 8–15, 16–30, 31–60, 60+ days) come with the Khata reports in Phase 5.</p>
          </div>
        );
      }}
    </Loaded>
  );
}
