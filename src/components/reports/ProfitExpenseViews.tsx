import { useState } from "react";
// Profit & loss and expense reports. Figures from report_period, report_trend
// and report_expenses only.
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { inrShort } from "@/lib/dashboard";
import { ExpenseReport, Grain, PeriodReport, ReportResult, TrendRow, grainFor, reportExpenses, reportPeriod, reportTrend } from "@/lib/reports/api";
import { COST_MISSING_NOTE } from "@/lib/reports/definitions";
import { dayCount, rangeLabel } from "@/lib/reports/dates";
import { ReportCtx, both, csvMeta, csvName, useReportData } from "./context";
import { GrainPicker } from "./SalesViews";
import { CHART_COLORS, ChangeBadge, InfoTip, Kpi, Loaded, METHOD_LABEL, NoData, Section, fmtBucket, inr, num, pct } from "./shared";

const R = "text-right";

// ---------------------------------------------------------------- P&L statement
export function PLStatement({ ctx }: { ctx: ReportCtx }) {
  const state = useReportData(
    () => both(reportPeriod(ctx.range.from, ctx.range.to, ctx.storeId), ctx.compare ? reportPeriod(ctx.compare.from, ctx.compare.to, ctx.storeId) : null),
    [ctx.run, ctx.storeId], ctx.onMissing,
  );
  return (
    <Loaded state={state} kpis={4}>
      {({ a: p, b: prev }) => {
        type Line = { label: string; k?: string; v: (x: PeriodReport) => number; strong?: boolean; lower?: boolean; show?: boolean };
        const lines: Line[] = [
          { label: "Gross sales", k: "gross_sales", v: (x) => x.gross_sales },
          { label: "Less discounts", k: "discounts", v: (x) => -x.discounts },
          { label: "Less sales returns", k: "returns", v: (x) => -x.returns },
          { label: "Net sales", k: "net_sales", v: (x) => x.net_sales, strong: true },
          { label: "Less sales with no saved cost", v: (x) => -x.cost_missing_value, show: p.cost_missing_value > 0 || (prev?.cost_missing_value ?? 0) > 0 },
          { label: "Less cost of goods sold", k: "cogs", v: (x) => -x.cogs },
          { label: "Gross profit", k: "gross_profit", v: (x) => x.gross_profit, strong: true },
          { label: "Less expenses", k: "expenses", v: (x) => -x.expenses },
          { label: "Less stock written off", k: "stock_written_off", v: (x) => -x.stock_written_off },
          { label: "Add other income (journals)", v: (x) => x.other_income, show: p.other_income !== 0 || (prev?.other_income ?? 0) !== 0 },
          { label: "Less other expenses (journals)", v: (x) => -x.other_expense, show: p.other_expense !== 0 || (prev?.other_expense ?? 0) !== 0 },
          { label: "Net profit", k: "net_profit", v: (x) => x.net_profit, strong: true },
        ].filter((l) => l.show !== false);
        return (
          <div className="space-y-4">
            {p.cost_missing_lines > 0 && (
              <Alert><AlertTriangle className="h-4 w-4" /><AlertTitle>{p.cost_missing_lines} bill lines have no saved cost</AlertTitle><AlertDescription>{COST_MISSING_NOTE}</AlertDescription></Alert>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi k="net_sales" value={inr(p.net_sales)} now={p.net_sales} before={prev ? prev.net_sales : undefined} compareLabel={ctx.compareLabel} />
              <Kpi k="gross_profit" value={inr(p.gross_profit)} now={p.gross_profit} before={prev ? prev.gross_profit : undefined} compareLabel={ctx.compareLabel}
                hint={p.gross_margin !== null ? `${p.gross_margin.toFixed(1)}% margin` : undefined} />
              <Kpi k="net_profit" value={inr(p.net_profit)} now={p.net_profit} before={prev ? prev.net_profit : undefined} compareLabel={ctx.compareLabel}
                tone={p.net_profit < 0 ? "bad" : "good"} hint={p.net_margin !== null ? `${p.net_margin.toFixed(1)}% margin` : undefined} />
              <Kpi k="purchases_total" value={inr(p.purchases_total)} hint="goes into stock, not into profit" />
            </div>
            <Section title="Profit & loss statement" description={`${rangeLabel(ctx.range)}. Without GST. Purchases go into stock; only the cost of what was sold is subtracted.`}
              csv={{ filename: csvName(ctx, "profit-and-loss"), meta: csvMeta(ctx, "Profit & loss statement", ["Without GST", ...(ctx.compare ? [`Compared with: ${rangeLabel(ctx.compare)}`] : [])]),
                rows: lines.map((l) => ({ line: l.label, amount: Math.round(l.v(p) * 100) / 100, ...(prev ? { compared_with: Math.round(l.v(prev) * 100) / 100 } : {}) })) }}>
              <Table>
                <TableHeader><TableRow>
                  <TableHead /><TableHead className={R}>{rangeLabel(ctx.range)}</TableHead>
                  {prev && ctx.compare && <><TableHead className={R}>{rangeLabel(ctx.compare)}</TableHead><TableHead className={R}>Change</TableHead></>}
                </TableRow></TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.label} className={l.strong ? "font-semibold bg-muted/40" : ""}>
                      <TableCell><span className="inline-flex items-center gap-1">{l.label}{l.k && <InfoTip k={l.k} />}</span></TableCell>
                      <TableCell className={`${R} tabular-nums ${l.strong && l.v(p) < 0 ? "text-destructive" : ""}`}>{inr(l.v(p), 2)}</TableCell>
                      {prev && <>
                        <TableCell className={`${R} tabular-nums text-muted-foreground`}>{inr(l.v(prev), 2)}</TableCell>
                        <TableCell className={R}>{l.label.startsWith("Less") ? <ChangeBadge now={-l.v(p)} before={-l.v(prev)} lowerIsBetter /> : <ChangeBadge now={l.v(p)} before={l.v(prev)} />}</TableCell>
                      </>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="grid sm:grid-cols-3 gap-2 text-sm mt-3">
                <div><span className="text-muted-foreground">Gross margin:</span> {pct(p.gross_margin)}</div>
                <div><span className="text-muted-foreground">Net margin:</span> {pct(p.net_margin)}</div>
                <div><span className="text-muted-foreground">GST collected (not income):</span> {inr(p.gst_collected, 2)}</div>
              </div>
            </Section>
          </div>
        );
      }}
    </Loaded>
  );
}

// ---------------------------------------------------------------- profit over time
function useGrain(ctx: ReportCtx, fallback?: Grain) {
  const days = dayCount(ctx.range);
  const [grain, setGrain] = useState<Grain | null>(null);
  const g = grain && !(grain === "day" && days > 400) ? grain : fallback && !(fallback === "day" && days > 400) ? fallback : grainFor(ctx.range.from, ctx.range.to);
  return { grain: g, setGrain, days };
}

export function PLTrend({ ctx }: { ctx: ReportCtx }) {
  const { grain, setGrain, days } = useGrain(ctx);
  const state = useReportData(() => reportTrend(ctx.range.from, ctx.range.to, ctx.storeId, grain), [ctx.run, ctx.storeId, grain], ctx.onMissing);
  return (
    <Loaded state={state} kpis={0}>
      {(t) => {
        const rows = t.filter((r) => r.bills || r.returns || r.expenses);
        if (rows.length === 0) return <NoData title="No sales or expenses in these dates" />;
        const data = t.map((r) => ({ ...r, label: fmtBucket(r.bucket, grain), after_exp: r.gross_profit - r.expenses }));
        const sum = (k: keyof TrendRow) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
        const best = [...rows].sort((a, b) => b.gross_profit - a.gross_profit)[0];
        return (
          <div className="space-y-4">
            <Section title="Profit over time" description="Without GST. Bars are net sales and cost of goods; the lines are gross profit and gross profit after expenses."
              actions={<GrainPicker value={grain} onChange={setGrain} days={days} />}>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} /><YAxis tickFormatter={(v) => inrShort(Number(v))} width={56} />
                  <Tooltip formatter={(v, name) => [inr(Number(v)), name]} /><Legend />
                  <Bar dataKey="net_sales" name="Net sales" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="cogs" name="Cost of goods sold" fill="hsl(var(--muted-foreground))" radius={[3, 3, 0, 0]} />
                  <Line dataKey="gross_profit" name="Gross profit" stroke="hsl(var(--success))" strokeWidth={2} dot={false} />
                  <Line dataKey="after_exp" name="After expenses" stroke="hsl(var(--warning))" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
              {best && <p className="text-sm text-muted-foreground mt-2">Best period: {fmtBucket(best.bucket, grain)} with {inr(best.gross_profit)} gross profit.</p>}
            </Section>
            <Section title="Period by period" description="Stock write-offs and journal entries are in the statement for the whole range, not split here."
              csv={{ filename: csvName(ctx, `profit-by-${grain}`), meta: csvMeta(ctx, "Profit by period", ["Without GST"]),
                rows: rows.map((r) => ({ period: r.bucket, net_sales: r.net_sales, cost_of_goods_sold: r.cogs, sales_without_saved_cost: r.cost_missing_value, gross_profit: r.gross_profit, expenses: r.expenses, after_expenses: Math.round((r.gross_profit - r.expenses) * 100) / 100 })) }}>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Period</TableHead><TableHead className={R}>Net sales</TableHead><TableHead className={R}>Cost of goods</TableHead>
                  <TableHead className={R}>Gross profit</TableHead><TableHead className={R}>Margin</TableHead><TableHead className={R}>Expenses</TableHead><TableHead className={R}>After expenses</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const base = r.net_sales - r.cost_missing_value;
                    return (
                      <TableRow key={r.bucket}>
                        <TableCell className="whitespace-nowrap">{fmtBucket(r.bucket, grain)}</TableCell><TableCell className={R}>{inr(r.net_sales, 2)}</TableCell>
                        <TableCell className={R}>{inr(r.cogs, 2)}</TableCell><TableCell className={R}>{inr(r.gross_profit, 2)}</TableCell>
                        <TableCell className={R}>{base > 0 ? pct((r.gross_profit * 100) / base) : "—"}</TableCell>
                        <TableCell className={R}>{inr(r.expenses, 2)}</TableCell>
                        <TableCell className={`${R} ${r.gross_profit - r.expenses < 0 ? "text-destructive" : ""}`}>{inr(r.gross_profit - r.expenses, 2)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter><TableRow className="font-semibold">
                  <TableCell>Total</TableCell><TableCell className={R}>{inr(sum("net_sales"), 2)}</TableCell><TableCell className={R}>{inr(sum("cogs"), 2)}</TableCell>
                  <TableCell className={R}>{inr(sum("gross_profit"), 2)}</TableCell>
                  <TableCell className={R}>{sum("net_sales") - sum("cost_missing_value") > 0 ? pct((sum("gross_profit") * 100) / (sum("net_sales") - sum("cost_missing_value"))) : "—"}</TableCell>
                  <TableCell className={R}>{inr(sum("expenses"), 2)}</TableCell><TableCell className={R}>{inr(sum("gross_profit") - sum("expenses"), 2)}</TableCell>
                </TableRow></TableFooter>
              </Table>
            </Section>
          </div>
        );
      }}
    </Loaded>
  );
}

// ---------------------------------------------------------------- expenses
export function ExpenseSummary({ ctx }: { ctx: ReportCtx }) {
  const state = useReportData(async (): Promise<ReportResult<{ e: ExpenseReport; prev: ExpenseReport | null; p: PeriodReport }>> => {
    const [e, p] = await Promise.all([
      both(reportExpenses(ctx.range.from, ctx.range.to, ctx.storeId), ctx.compare ? reportExpenses(ctx.compare.from, ctx.compare.to, ctx.storeId) : null),
      reportPeriod(ctx.range.from, ctx.range.to, ctx.storeId),
    ]);
    if (e.status !== "ok") return e;
    if (p.status !== "ok") return p;
    return { status: "ok", data: { e: e.data.a, prev: e.data.b, p: p.data } };
  }, [ctx.run, ctx.storeId], ctx.onMissing);
  return (
    <Loaded state={state} kpis={4}>
      {({ e, prev, p }) => {
        const share = p.net_sales > 0 ? (e.total * 100) / p.net_sales : null;
        const prevByCat = new Map((prev?.by_category ?? []).map((r) => [r.category, r.amount]));
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi k="expenses" value={inr(e.total)} now={e.total} before={prev ? prev.total : undefined} lowerIsBetter compareLabel={ctx.compareLabel} hint={`${e.count} entries`} />
              <Kpi label="Share of net sales" value={pct(share)} hint="expenses ÷ net sales" />
              <Kpi label="Recurring" value={inr(e.recurring_total)} hint="from repeating expenses" />
              <Kpi label="Waiting for approval" value={e.pending_count ? inr(e.pending_total) : "None"} hint={e.pending_count ? `${e.pending_count} entries, not counted` : undefined} />
            </div>
            {e.count === 0 ? <NoData title="No approved expenses in these dates" /> : (
              <div className="grid gap-4 xl:grid-cols-2">
                <Section title="By category" description="Approved expenses only.">
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie data={e.by_category} dataKey="amount" nameKey="category" innerRadius={60} outerRadius={105} paddingAngle={1}>
                        {e.by_category.map((r, i) => <Cell key={r.category} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v, name) => [`${inr(Number(v))} (${pct((Number(v) * 100) / e.total)})`, name]} /><Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </Section>
                <Section title="Details" csv={{ filename: csvName(ctx, "expenses"), meta: csvMeta(ctx, "Expense breakdown", ["Approved expenses only"]),
                  rows: [...e.by_category.map((r) => ({ group: "Category", name: r.category, entries: r.count, amount: r.amount, ...(prev ? { compared_with: prevByCat.get(r.category) ?? 0 } : {}) })),
                    ...e.by_method.map((r) => ({ group: "Paid by", name: METHOD_LABEL[r.method] ?? r.method, entries: r.count, amount: r.amount }))] }}>
                  <Table>
                    <TableHeader><TableRow><TableHead>Category</TableHead><TableHead className={R}>Entries</TableHead><TableHead className={R}>Amount</TableHead><TableHead className={R}>Share</TableHead>{prev && <TableHead className={R}>Change</TableHead>}</TableRow></TableHeader>
                    <TableBody>
                      {e.by_category.map((r) => (
                        <TableRow key={r.category}>
                          <TableCell>{r.category}</TableCell><TableCell className={R}>{r.count}</TableCell><TableCell className={R}>{inr(r.amount, 2)}</TableCell>
                          <TableCell className={R}>{pct((r.amount * 100) / e.total)}</TableCell>
                          {prev && <TableCell className={R}><ChangeBadge now={r.amount} before={prevByCat.get(r.category) ?? 0} lowerIsBetter /></TableCell>}
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter><TableRow className="font-semibold"><TableCell>Total</TableCell><TableCell className={R}>{e.count}</TableCell><TableCell className={R}>{inr(e.total, 2)}</TableCell><TableCell className={R}>100%</TableCell>{prev && <TableCell />}</TableRow></TableFooter>
                  </Table>
                  <p className="text-sm font-medium mt-4 mb-1">Paid by</p>
                  <Table>
                    <TableBody>
                      {e.by_method.map((r) => (
                        <TableRow key={r.method}><TableCell>{METHOD_LABEL[r.method] ?? r.method}</TableCell><TableCell className={R}>{r.count}</TableCell><TableCell className={R}>{inr(r.amount, 2)}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {e.from_till_total > 0 && <p className="text-xs text-muted-foreground mt-2">{inr(e.from_till_total, 2)} was paid from the cash counter.</p>}
                </Section>
              </div>
            )}
          </div>
        );
      }}
    </Loaded>
  );
}

export function ExpenseTrend({ ctx }: { ctx: ReportCtx }) {
  const { grain, setGrain, days } = useGrain(ctx, dayCount(ctx.range) > 45 ? "month" : "week");
  const state = useReportData(() => reportTrend(ctx.range.from, ctx.range.to, ctx.storeId, grain), [ctx.run, ctx.storeId, grain], ctx.onMissing);
  return (
    <Loaded state={state} kpis={0}>
      {(t) => {
        const rows = t.filter((r) => r.expenses || r.net_sales);
        if (rows.length === 0) return <NoData title="No sales or expenses in these dates" />;
        const data = t.map((r) => ({ ...r, label: fmtBucket(r.bucket, grain), share: r.net_sales > 0 ? Math.round((r.expenses * 1000) / r.net_sales) / 10 : null }));
        const totE = rows.reduce((a, r) => a + r.expenses, 0), totS = rows.reduce((a, r) => a + r.net_sales, 0);
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Kpi k="expenses" value={inr(totE)} />
              <Kpi k="net_sales" value={inr(totS)} />
              <Kpi label="Expenses as % of net sales" value={totS > 0 ? pct((totE * 100) / totS) : "—"} />
            </div>
            <Section title="Expenses vs net sales" description="Bars in ₹; the line is expenses as a % of net sales (right axis). Net sales without GST."
              actions={<GrainPicker value={grain} onChange={setGrain} days={days} />}
              csv={{ filename: csvName(ctx, `expenses-vs-sales-by-${grain}`), meta: csvMeta(ctx, "Expenses vs sales"),
                rows: rows.map((r) => ({ period: r.bucket, net_sales: r.net_sales, expenses: r.expenses, expenses_pct_of_sales: r.net_sales > 0 ? Math.round((r.expenses * 1000) / r.net_sales) / 10 : "" })) }}>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="amt" tickFormatter={(v) => inrShort(Number(v))} width={56} />
                  <YAxis yAxisId="pct" orientation="right" tickFormatter={(v) => `${v}%`} width={44} />
                  <Tooltip formatter={(v, name) => (name === "Expenses % of sales" ? [v === null ? "—" : `${v}%`, name] : [inr(Number(v)), name])} /><Legend />
                  <Bar yAxisId="amt" dataKey="net_sales" name="Net sales" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  <Bar yAxisId="amt" dataKey="expenses" name="Expenses" fill="hsl(var(--destructive))" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="pct" dataKey="share" name="Expenses % of sales" stroke="hsl(var(--warning))" dot={false} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <p className="text-xs text-muted-foreground mt-2">{num(rows.length)} periods with activity. No % is shown where there were no sales.</p>
            </Section>
          </div>
        );
      }}
    </Loaded>
  );
}
