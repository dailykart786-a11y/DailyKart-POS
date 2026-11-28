// Sales explorer (Phase 7): group sales and profit by any dimension, filter,
// compare with the page's comparison period and click a row or bar to drill
// down. Grouping and filters live in the page link, so the browser's Back
// button steps back up a drill-down. Figures come from report_sales_explore.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronRight, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { inrShort } from "@/lib/dashboard";
import { ExploreGroup, ExploreRow, FilterOptions, reportFilterOptions, reportSalesExplore } from "@/lib/reports/api";
import { addDays, rangeLabel } from "@/lib/reports/dates";
import { DRILL_NEXT, ExploreState, GROUP_LABEL, readExplore, writeExplore } from "@/lib/reports/explore";
import { ReportCtx, csvMeta, csvName, useReportData } from "./context";
import { CHART_COLORS, Kpi, Loaded, METHOD_LABEL, NoData, Section, changeOf, fmtBucket, inr, num, pct } from "./shared";
import { Pager } from "./paging";
import { NeedsUpdate as Needs, useMissing } from "./missing";

const R = "text-right";
const ANY = "__any";
const NeedsUpdate = () => <Needs file="phase7-reports-explore.sql" />;
const TIME: ExploreGroup[] = ["day", "week", "month", "hour", "weekday"];
const methodName = (m: string) => METHOD_LABEL[m] ?? (m === "split" ? "Split payment" : m);
const monthEnd = (iso: string) => { const d = new Date(iso + "T00:00:00"); return addDays(new Date(d.getFullYear(), d.getMonth() + 1, 1).toLocaleDateString("en-CA"), -1); };
const clamp = (from: string, to: string, r: { from: string; to: string }) => ({ from: from < r.from ? r.from : from, to: to > r.to ? r.to : to });

function rowLabel(group: ExploreGroup, r: ExploreRow) {
  if (group === "day" || group === "week" || group === "month") return fmtBucket(r.key, group);
  if (group === "payment") return methodName(r.key);
  return r.label;
}

/** The narrower view one click on a row opens, or null when there's nothing below it. */
function drill(s: ExploreState, r: ExploreRow, range: { from: string; to: string }): ExploreState | null {
  const next = DRILL_NEXT[s.group];
  if (!next) return null;
  const base: ExploreState = { ...s, group: next };
  switch (s.group) {
    case "day": return { ...base, from: r.key, to: r.key };
    case "week": return { ...base, ...clamp(r.key, addDays(r.key, 6), range) };
    case "month": return { ...base, ...clamp(r.key, monthEnd(r.key), range) };
    case "category": return { ...base, category: r.key };
    case "product": return r.key ? { ...base, productId: r.key, productName: r.label } : null;
    case "cashier": return r.key ? { ...base, cashierId: r.key, cashierName: r.label } : null;
    case "customer": return r.key ? { ...base, customerId: r.key, customerName: r.label, customerType: "all" } : { ...base, customerType: "walkin" };
    case "payment": return { ...base, method: r.key };
    default: return null;
  }
}

function FilterSelect({ label, value, options, onChange, width = "w-[150px]" }: {
  label: string; value: string | null | undefined; options: { value: string; label: string }[]; onChange: (v: string | null) => void; width?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <Select value={value ?? ANY} onValueChange={(v) => onChange(v === ANY ? null : v)}>
        <SelectTrigger className={`h-9 ${width}`} aria-label={label}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>All</SelectItem>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export function SalesExplorer({ ctx }: { ctx: ReportCtx }) {
  const [params, setParams] = useSearchParams();
  const s = useMemo(() => readExplore(params), [params]);
  const set = (next: ExploreState) => setParams((p) => writeExplore(p, next), { replace: false });
  const [missing, onMissing] = useMissing();
  const [opts, setOpts] = useState<FilterOptions | null>(null);
  const [sort, setSort] = useState("net_sales");
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);

  const narrowed = !!(s.from && s.to);
  const range = narrowed ? { from: s.from!, to: s.to! } : ctx.range;
  const compare = narrowed ? null : ctx.compare;
  const isTime = TIME.includes(s.group);
  const pageSize = isTime ? 100 : size;
  const key = JSON.stringify(s);

  useEffect(() => { setPage(0); }, [key, sort, ctx.run, ctx.storeId]);
  useEffect(() => {
    let live = true;
    reportFilterOptions(ctx.storeId).then((r) => { if (live && r.status === "ok") setOpts(r.data); });
    return () => { live = false; };
  }, [ctx.storeId]);

  const state = useReportData(
    () => reportSalesExplore(range.from, range.to, ctx.storeId, s.group, s, compare, { sort, limit: pageSize, offset: page * pageSize }),
    [ctx.run, ctx.storeId, key, sort, page, pageSize, compare?.from, compare?.to], onMissing,
  );
  if (missing) return <NeedsUpdate />;

  const chips: { label: string; clear: Partial<ExploreState> }[] = [
    narrowed && { label: `Dates: ${rangeLabel(range)}`, clear: { from: null, to: null } },
    s.productId && { label: `Product: ${s.productName ?? "one product"}`, clear: { productId: null, productName: null } },
    s.customerId && { label: `Customer: ${s.customerName ?? "one customer"}`, clear: { customerId: null, customerName: null } },
  ].filter(Boolean) as { label: string; clear: Partial<ExploreState> }[];
  const anyFilter = chips.length > 0 || !!s.category || !!s.cashierId || !!s.method || s.customerType !== "all";
  const groups = (Object.keys(GROUP_LABEL) as ExploreGroup[]).filter((g) => !(g === "product" && s.productId) && !(g === "customer" && s.customerId));
  const staffOptions = [...(opts?.staff ?? [])];
  if (s.cashierId && !staffOptions.some((o) => o.id === s.cashierId)) staffOptions.push({ id: s.cashierId, name: s.cashierName ?? "Selected staff" });
  const categoryOptions = [...(opts?.categories ?? [])];
  if (s.category && !categoryOptions.includes(s.category)) categoryOptions.push(s.category);

  return (
    <div className="space-y-4">
      <Section title="Explore" description="Pick how to group, narrow it down, then click any row or bar to drill in. Your browser's Back button steps back out.">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Group by</div>
            <Select value={s.group} onValueChange={(v) => set({ ...s, group: v as ExploreGroup })}>
              <SelectTrigger className="h-9 w-[170px]" aria-label="Group by"><SelectValue /></SelectTrigger>
              <SelectContent>{groups.map((g) => <SelectItem key={g} value={g}>{GROUP_LABEL[g]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <FilterSelect label="Category" value={s.category} onChange={(v) => set({ ...s, category: v })}
            options={categoryOptions.map((c) => ({ value: c, label: c }))} />
          <FilterSelect label="Staff" value={s.cashierId} onChange={(v) => set({ ...s, cashierId: v, cashierName: staffOptions.find((o) => o.id === v)?.name ?? null })}
            options={staffOptions.map((o) => ({ value: o.id, label: o.name }))} />
          <FilterSelect label="Payment" value={s.method} width="w-[140px]" onChange={(v) => set({ ...s, method: v })}
            options={(opts?.methods ?? (s.method ? [s.method] : [])).map((m) => ({ value: m, label: methodName(m) }))} />
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Customers</div>
            <Select value={s.customerType ?? "all"} onValueChange={(v) => set({ ...s, customerType: v as ExploreState["customerType"], ...(v === "walkin" ? { customerId: null, customerName: null } : {}) })}>
              <SelectTrigger className="h-9 w-[150px]" aria-label="Customers"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="registered">Saved customers</SelectItem>
                <SelectItem value="walkin">Walk-in only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {anyFilter && <Button variant="ghost" size="sm" className="h-9" onClick={() => set({ group: s.group })}>Clear filters</Button>}
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {chips.map((c) => (
              <Badge key={c.label} variant="secondary" className="gap-1 pr-1 font-normal">
                {c.label}
                <button type="button" aria-label={`Remove ${c.label}`} className="rounded-sm p-0.5 hover:bg-muted-foreground/20" onClick={() => set({ ...s, ...c.clear })}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        {narrowed && ctx.compare && <p className="text-xs text-muted-foreground mt-2">No comparison while the dates are narrowed by a drill-down.</p>}
      </Section>

      <Loaded state={state} kpis={4}>
        {(x) => {
          const c = x.totals.cur, p = x.totals.prev;
          const label = ctx.compareLabel;
          if (c.bills === 0 && c.returns === 0)
            return <NoData title="No sales match" description={anyFilter ? "Try removing a filter, or pick other dates." : "No bills in these dates."} />;
          const showPrev = !!p && !isTime;
          const data = x.rows.slice(0, isTime ? 100 : 15).map((r) => ({ ...r, name: rowLabel(x.group, r) }));
          const canDrill = !!DRILL_NEXT[x.group];
          const go = (r: ExploreRow) => { const n = drill(s, r, range); if (n) set(n); };
          const vertical = !isTime;
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi k="net_sales" value={inr(c.net_sales)} now={c.net_sales} before={p?.net_sales} compareLabel={label} hint={p ? undefined : `GST ${inr(c.gst)}`} />
                <Kpi k="gross_profit" value={inr(c.profit)} now={c.profit} before={p?.profit} compareLabel={label} hint={c.margin != null ? `${pct(c.margin)}${p ? "" : " margin"}` : undefined} />
                <Kpi label="Bills" value={num(c.bills)} now={c.bills} before={p?.bills} money={false} compareLabel={label} hint={p ? undefined : `${num(c.units)} units`} />
                <Kpi label="Average bill" value={c.avg_bill != null ? inr(c.avg_bill) : "—"} now={c.avg_bill} before={p?.avg_bill} compareLabel={label} hint={p ? undefined : "before GST and returns"} />
              </div>
              {c.cost_missing_value > 0 && (
                <p className="text-xs text-muted-foreground">{inr(c.cost_missing_value)} of sales have no saved purchase cost and are left out of profit.</p>
              )}
              <Section title={`Net sales by ${GROUP_LABEL[x.group].toLowerCase()}`}
                description={canDrill ? `Click a bar to see it by ${GROUP_LABEL[DRILL_NEXT[x.group]!].toLowerCase()}.` : "Without GST, after returns."}>
                <ResponsiveContainer width="100%" height={vertical ? Math.max(200, data.length * (showPrev ? 44 : 32) + 40) : 280}>
                  {vertical ? (
                    <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={(v) => inrShort(Number(v))} fontSize={12} />
                      <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} tickFormatter={(v: string) => (v.length > 17 ? v.slice(0, 16) + "…" : v)} />
                      <Tooltip formatter={(v, n) => [inr(Number(v)), n]} />
                      {showPrev && <Legend />}
                      <Bar dataKey="net_sales" name="Net sales" fill={CHART_COLORS[0]} radius={[0, 3, 3, 0]} cursor={canDrill ? "pointer" : undefined}
                        onClick={(d) => { const r = (d as unknown as { payload?: ExploreRow }).payload; if (r) go(r); }} />
                      {showPrev && <Bar dataKey="prev_net_sales" name={`Before (${label})`} fill={CHART_COLORS[1]} radius={[0, 3, 3, 0]} />}
                    </BarChart>
                  ) : (
                    <BarChart data={data}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" fontSize={12} /><YAxis tickFormatter={(v) => inrShort(Number(v))} width={56} fontSize={12} />
                      <Tooltip formatter={(v, n) => [inr(Number(v)), n]} />
                      <Bar dataKey="net_sales" name="Net sales" fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} cursor={canDrill ? "pointer" : undefined}
                        onClick={(d) => { const r = (d as unknown as { payload?: ExploreRow }).payload; if (r) go(r); }} />
                    </BarChart>
                  )}
                </ResponsiveContainer>
                {!isTime && x.total > data.length && <p className="text-xs text-muted-foreground mt-1">Chart shows the first {data.length} on this page; the table lists all {num(x.total)}.</p>}
              </Section>
              <Section title="Details" description={`Amounts without GST. Returns count on the day they came back${x.group === "cashier" ? ", under the person who took them" : ""}.`}
                actions={!isTime ? (
                  <Select value={sort} onValueChange={setSort}>
                    <SelectTrigger className="h-8 w-[150px]" aria-label="Sort by"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="net_sales">Net sales</SelectItem><SelectItem value="profit">Gross profit</SelectItem>
                      <SelectItem value="bills">Bills</SelectItem><SelectItem value="units">Units</SelectItem>
                      {p && <SelectItem value="change">Change vs before</SelectItem>}
                    </SelectContent>
                  </Select>
                ) : undefined}
                csv={{ filename: csvName({ ...ctx, range }, `sales-by-${x.group}`), meta: csvMeta({ ...ctx, range }, `Sales by ${GROUP_LABEL[x.group].toLowerCase()}`, [
                    ...(s.category ? [`Category: ${s.category}`] : []), ...(s.cashierName ? [`Staff: ${s.cashierName}`] : []),
                    ...(s.method ? [`Payment: ${methodName(s.method)}`] : []), ...(s.productName ? [`Product: ${s.productName}`] : []),
                    ...(s.customerName ? [`Customer: ${s.customerName}`] : []), ...(s.customerType !== "all" ? [`Customers: ${s.customerType}`] : []),
                    ...(showPrev && compare ? [`Compared with ${rangeLabel(compare)}`] : []),
                    `Rows ${page * pageSize + 1} to ${page * pageSize + x.rows.length} of ${x.total}`]),
                  rows: x.rows.map((r) => ({ [x.group]: rowLabel(x.group, r), bills: r.bills, units: r.units, net_sales: r.net_sales, share_pct: r.share ?? "",
                    returns: r.returns, gst: r.gst, gross_profit: r.profit, margin_pct: r.margin ?? "", sales_without_saved_cost: r.cost_missing_value,
                    ...(showPrev ? { net_sales_before: r.prev_net_sales ?? 0, gross_profit_before: r.prev_profit ?? 0 } : {}) })) }}>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="min-w-[140px]">{GROUP_LABEL[x.group]}</TableHead><TableHead className={R}>Bills</TableHead>
                    <TableHead className={R}>Units</TableHead><TableHead className={R}>Net sales</TableHead>
                    {showPrev && <TableHead className={R}>vs before</TableHead>}
                    <TableHead className={R}>Gross profit</TableHead>
                    {canDrill && <TableHead className="w-6" />}
                  </TableRow></TableHeader>
                  <TableBody>
                    {x.rows.map((r) => {
                      const ch = showPrev ? changeOf(r.net_sales, r.prev_net_sales ?? 0) : null;
                      const drillable = canDrill && !!drill(s, r, range);
                      return (
                        <TableRow key={r.key || "none"} className={drillable ? "cursor-pointer" : undefined} onClick={drillable ? () => go(r) : undefined}
                          tabIndex={drillable ? 0 : undefined} onKeyDown={drillable ? (e) => { if (e.key === "Enter") go(r); } : undefined}>
                          <TableCell className="font-medium">{rowLabel(x.group, r)}{r.category && <div className="text-xs text-muted-foreground font-normal">{r.category}</div>}</TableCell>
                          <TableCell className={R}>{num(r.bills)}</TableCell><TableCell className={R}>{num(r.units)}</TableCell>
                          <TableCell className={R}>{inr(r.net_sales, 2)}{r.share != null && <div className="text-xs text-muted-foreground">{pct(r.share)}{r.returns ? ` · ${inr(r.returns)} back` : ""}</div>}</TableCell>
                          {showPrev && (
                            <TableCell className={`${R} whitespace-nowrap`}>
                              {inr(r.prev_net_sales ?? 0)}
                              <div className={`text-xs ${ch && ch.diff < 0 ? "text-destructive" : ch && ch.diff > 0 ? "text-success" : "text-muted-foreground"}`}>
                                {ch?.pct != null ? `${ch.pct > 0 ? "+" : "−"}${Math.abs(ch.pct).toFixed(1)}%` : ch?.newFromZero ? "new" : "—"}
                              </div>
                            </TableCell>
                          )}
                          <TableCell className={`${R} ${r.profit < 0 ? "text-destructive" : ""}`}>{inr(r.profit, 2)}{r.margin != null && <div className="text-xs text-muted-foreground">{pct(r.margin)}</div>}</TableCell>
                          {canDrill && <TableCell className="text-muted-foreground">{drillable && <ChevronRight className="h-4 w-4" />}</TableCell>}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  {x.total <= x.rows.length && (
                    <TableFooter><TableRow className="font-semibold">
                      <TableCell>Total</TableCell><TableCell className={R}>{num(c.bills)}</TableCell><TableCell className={R}>{num(c.units)}</TableCell>
                      <TableCell className={R}>{inr(c.net_sales, 2)}</TableCell>
                      {showPrev && <TableCell className={R}>{inr(p!.net_sales)}</TableCell>}
                      <TableCell className={R}>{inr(c.profit, 2)}</TableCell>{canDrill && <TableCell />}
                    </TableRow></TableFooter>
                  )}
                </Table>
                {x.group === "customer" && c.customers > 0 && <p className="text-xs text-muted-foreground mt-2">{num(c.customers)} saved customers bought in these dates.</p>}
                {x.total > pageSize && <Pager page={page} size={pageSize} total={x.total} setPage={setPage} setSize={isTime ? () => undefined : setSize} />}
              </Section>
            </div>
          );
        }}
      </Loaded>
    </div>
  );
}
