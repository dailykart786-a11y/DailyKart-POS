// Inventory, movers, expiry, stock movement and purchase reports (Phase 4).
// Every figure comes from the report_inventory / report_expiry /
// report_stock_movement / report_purchases functions; tables are paged on the server.
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { inrShort } from "@/lib/dashboard";
import {
  InventoryRow, PurchaseBy, StockFilter, reportExpiry, reportInventory, reportPurchases, reportStockMovement,
} from "@/lib/reports/api";
import { rangeLabel } from "@/lib/reports/dates";
import { ReportCtx, csvMeta, csvName, useReportData } from "./context";
import { CHART_COLORS, Kpi, Loaded, NoData, Section, inr, num } from "./shared";
import { Pager, useDebounced } from "./paging";
import { NeedsUpdate as Needs, useMissing } from "./missing";

const NeedsUpdate = () => <Needs file="phase4-reports-stock-purchases.sql" />;

const R = "text-right";
const plural = (n: number, one: string, many = one + "s") => `${num(n)} ${n === 1 ? one : many}`;

const day = (s: string | null | undefined) =>
  s ? new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Kolkata" }) : "—";
const dateTime = (s: string) =>
  new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

const MOVEMENT_LABEL: Record<string, string> = { fast: "Fast", normal: "Steady", slow: "Slow", dead: "Not moving", none: "—" };
const STATUS_LABEL: Record<string, string> = { ok: "In stock", low: "Low", out: "Out" };

function MovementBadge({ m }: { m: string }) {
  if (m === "none") return <span className="text-muted-foreground">—</span>;
  const cls = m === "fast" ? "bg-success/15 text-success border-success/30" : m === "dead" ? "bg-destructive/10 text-destructive border-destructive/30"
    : m === "slow" ? "bg-warning/20 text-warning-foreground border-warning/40" : "";
  return <Badge variant="outline" className={`whitespace-nowrap ${cls}`}>{MOVEMENT_LABEL[m] ?? m}</Badge>;
}

function StatusBadge({ s }: { s: string }) {
  return <Badge variant="outline" className={`whitespace-nowrap ${s === "out" ? "bg-destructive/10 text-destructive border-destructive/30" : "bg-warning/20 text-warning-foreground border-warning/40"}`}>{STATUS_LABEL[s] ?? s}</Badge>;
}

// ---------------------------------------------------------------- stock value and movers
const STOCK_FILTERS: { key: StockFilter; label: string }[] = [
  { key: "all", label: "All products" }, { key: "in", label: "In stock" }, { key: "low", label: "Low stock" }, { key: "out", label: "Out of stock" },
  { key: "fast", label: "Fast moving" }, { key: "slow", label: "Slow moving" }, { key: "dead", label: "Not moving" },
];
const STOCK_SORTS = [
  { key: "value", label: "Stock value" }, { key: "stock", label: "Stock qty" }, { key: "sold", label: "Units sold" },
  { key: "cover", label: "Days of stock" }, { key: "last_sold", label: "Last sold" }, { key: "name", label: "Name" },
];

export function StockReport({ ctx, mode }: { ctx: ReportCtx; mode: "valuation" | "movers" }) {
  const [missing, onMissing] = useMissing();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<StockFilter>(mode === "movers" ? "fast" : "all");
  const [sort, setSort] = useState(mode === "movers" ? "sold" : "value");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  useEffect(() => { setPage(0); }, [q, category, status, sort, dir, ctx.run, ctx.storeId]);

  // categories for the filter: from an unfiltered call, so the list doesn't shrink once one is picked
  const cats = useReportData(() => reportInventory(ctx.range.from, ctx.range.to, ctx.storeId, { limit: 1 }), [ctx.run, ctx.storeId], onMissing);
  const state = useReportData(
    () => reportInventory(ctx.range.from, ctx.range.to, ctx.storeId, {
      search: q || null, category: category === "all" ? null : category, status, sort, dir, limit: size, offset: page * size,
    }),
    [ctx.run, ctx.storeId, q, category, status, sort, dir, page, size], onMissing,
  );
  if (missing) return <NeedsUpdate />;
  const catList = cats.status === "ok" ? cats.data.categories.map((c) => c.key).filter(Boolean) : [];
  const filters = mode === "movers" ? STOCK_FILTERS.filter((f) => ["fast", "slow", "dead", "all"].includes(f.key)) : STOCK_FILTERS;
  const pickStatus = (v: StockFilter) => {
    setStatus(v);
    if (mode === "movers") { setSort(v === "dead" ? "value" : "sold"); setDir(v === "slow" ? "asc" : "desc"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input className="w-full sm:w-60" placeholder="Search name, SKU or barcode" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
        <Select value={status} onValueChange={(v) => pickStatus(v as StockFilter)}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Show"><SelectValue /></SelectTrigger>
          <SelectContent>{filters.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Category"><SelectValue placeholder="All categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {catList.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => { setSort(v); setDir(v === "name" ? "asc" : "desc"); }}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Sort by"><SelectValue /></SelectTrigger>
          <SelectContent>{STOCK_SORTS.map((s) => <SelectItem key={s.key} value={s.key}>Sort: {s.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" onClick={() => setDir(dir === "desc" ? "asc" : "desc")} aria-label="Reverse order">
          {dir === "desc" ? "Highest first" : "Lowest first"}
        </Button>
      </div>
      <Loaded state={state} kpis={4}>
        {(inv) => {
          const t = inv.totals;
          const filtered = !!q || category !== "all";
          const chart = inv.categories.slice(0, 10).map((c) => ({ name: c.label.length > 16 ? c.label.slice(0, 15) + "…" : c.label, value: c.value_cost, dead: c.dead_value }));
          const statusLabel = STOCK_FILTERS.find((f) => f.key === status)?.label ?? "";
          return (
            <>
              {mode === "valuation" ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Kpi k="inventory_value" value={inr(t.value_cost)} hint={`${plural(t.skus, "product")}${filtered ? " matching" : ""}`} />
                  <Kpi k="inventory_mrp_value" value={inr(t.value_mrp)} hint={t.value_cost > 0 ? `${inr(t.value_mrp - t.value_cost)} above cost` : undefined} />
                  <Kpi label="Low / out of stock" value={`${num(t.low_stock)} / ${num(t.out_of_stock)}`} tone={t.out_of_stock > 0 ? "bad" : undefined}
                    onClick={() => pickStatus(t.out_of_stock > 0 ? "out" : "low")} hint={t.negative_stock ? `${t.negative_stock} below zero` : "tap to list"} />
                  <Kpi k="dead_stock" value={inr(t.dead_value)} hint={`${plural(t.dead, "product")} sold nothing`} tone={t.dead_value > 0 ? "bad" : undefined}
                    onClick={() => pickStatus("dead")} />
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Kpi k="fast_movers" value={num(t.fast)} hint="top 20% by units" onClick={() => pickStatus("fast")} tone="good" />
                  <Kpi label="Slow moving" value={num(t.slow)} hint="bottom 30% that sold" onClick={() => pickStatus("slow")} />
                  <Kpi k="dead_stock" value={num(t.dead)} hint={`${inr(t.dead_value)} of stock`} onClick={() => pickStatus("dead")} tone={t.dead > 0 ? "bad" : undefined} />
                  <Kpi label="Units sold" value={num(t.sold_units)} hint={`${inv.days} days`} />
                </div>
              )}
              {mode === "valuation" && chart.length > 0 && (
                <Section title="Stock value by category" description="At latest purchase cost. Red part: stock that sold nothing in the dates you picked."
                  csv={{ filename: csvName(ctx, "stock-by-category"), meta: csvMeta(ctx, "Stock value by category", ["Stock as of now; 'not moving' uses the dates above", ...(q ? [`Search: ${q}`] : [])]),
                    rows: inv.categories.map((c) => ({ category: c.label, products: c.skus, stock_units: c.stock_units, value_at_cost: c.value_cost, value_at_mrp: c.value_mrp, not_moving_value: c.dead_value, units_sold: c.sold_units })) }}>
                  <ResponsiveContainer width="100%" height={Math.max(200, chart.length * 34)}>
                    <BarChart data={chart} layout="vertical" margin={{ left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={(v) => inrShort(Number(v))} />
                      <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v, name) => [inr(Number(v)), name]} /><Legend />
                      <Bar dataKey="value" name="Stock value" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} />
                      <Bar dataKey="dead" name="Not moving" fill="hsl(var(--destructive))" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Section>
              )}
              {inv.total === 0 ? (
                <NoData title={filtered || status !== "all" ? `No products: ${statusLabel.toLowerCase()}` : "No active products"}
                  description={status === "dead" ? "Everything in stock sold at least once in these dates." : undefined} />
              ) : (
                <Section title={statusLabel}
                  description={`Stock and value as of now. Units sold, days of stock and movement use ${rangeLabel(ctx.range)}.`}
                  csv={{ filename: csvName(ctx, mode === "movers" ? `movers-${status}` : "stock"), meta: csvMeta(ctx, mode === "movers" ? "Fast, slow and non-moving" : "Stock value and status",
                    [`Show: ${statusLabel}`, "Stock as of now, valued at latest purchase cost", `Rows ${page * size + 1} to ${page * size + inv.rows.length} of ${inv.total}`, ...(q ? [`Search: ${q}`] : []), ...(category !== "all" ? [`Category: ${category}`] : [])]),
                    rows: inv.rows.map((r: InventoryRow) => ({ product: r.name, sku: r.sku, barcode: r.barcode, category: r.category, stock: r.stock, min_level: r.min_level, status: STATUS_LABEL[r.stock_status],
                      cost_price: r.cost, value_at_cost: r.value_cost, mrp_or_price: r.mrp ?? r.price, value_at_mrp: r.value_mrp, units_sold: r.sold_units, units_returned: r.returned_units,
                      sales_ex_gst: r.revenue, avg_per_day: r.avg_daily, days_of_stock: r.days_cover ?? "", movement: MOVEMENT_LABEL[r.movement], last_sold: r.last_sold_at ?? "", last_purchased: r.last_purchased_at ?? "" })) }}>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Product</TableHead><TableHead>Movement</TableHead><TableHead className={R}>Stock</TableHead><TableHead className={R}>Value</TableHead>
                      <TableHead className={R}>Sold</TableHead><TableHead className={R}>Per day</TableHead><TableHead className={`${R} whitespace-nowrap`}>Lasts (days)</TableHead>
                      <TableHead>Last sold</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {inv.rows.map((r) => (
                        <TableRow key={r.product_id}>
                          <TableCell className="min-w-[160px]"><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{[r.sku, r.category].filter(Boolean).join(" · ")}</div></TableCell>
                          <TableCell><MovementBadge m={r.movement} /></TableCell>
                          <TableCell className={`${R} ${r.stock < 0 ? "text-destructive" : ""}`}>{num(r.stock)}{r.stock_status !== "ok" ? <div className="mt-0.5"><StatusBadge s={r.stock_status} /></div> : r.min_level ? <div className="text-xs text-muted-foreground">min {num(r.min_level)}</div> : null}</TableCell>
                          <TableCell className={`${R} whitespace-nowrap`}>{inr(r.value_cost)}<div className="text-xs text-muted-foreground">at {inr(r.cost, 2)}</div></TableCell>
                          <TableCell className={R}>{num(r.sold_units)}</TableCell>
                          <TableCell className={R}>{r.avg_daily ? num(Math.round(r.avg_daily * 10) / 10) : "—"}</TableCell>
                          <TableCell className={R}>{r.days_cover === null ? "—" : num(Math.round(r.days_cover))}</TableCell>
                          <TableCell className="whitespace-nowrap">{r.last_sold_at ? <>{day(r.last_sold_at)}<div className="text-xs text-muted-foreground">{r.days_since_sale === 0 ? "today" : r.days_since_sale === 1 ? "yesterday" : `${r.days_since_sale} days ago`}</div></> : <span className="text-muted-foreground">never</span>}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Pager page={page} size={size} total={inv.total} setPage={setPage} setSize={setSize} />
                </Section>
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

// ---------------------------------------------------------------- expiry
const EXPIRY_WINDOWS = [7, 30, 60, 90, 180];
const BUCKET_COLOR: Record<string, string> = {
  expired: "hsl(var(--destructive))", d0_7: "hsl(var(--destructive) / 0.7)", d8_30: "hsl(var(--warning))",
  d31_60: "hsl(var(--warning) / 0.6)", d61_90: "hsl(var(--primary) / 0.6)", d90_plus: "hsl(var(--muted-foreground))",
};

export function StockExpiry({ ctx }: { ctx: ReportCtx }) {
  const [missing, onMissing] = useMissing();
  const [days, setDays] = useState(90);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  useEffect(() => { setPage(0); }, [q, days, ctx.run, ctx.storeId]);
  const state = useReportData(() => reportExpiry(ctx.storeId, days, { search: q || null, limit: size, offset: page * size }),
    [ctx.run, ctx.storeId, days, q, page, size], onMissing);
  if (missing) return <NeedsUpdate />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input className="w-full sm:w-60" placeholder="Search product or batch" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search batches" />
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-full sm:w-56" aria-label="Expiring within"><SelectValue /></SelectTrigger>
          <SelectContent>{EXPIRY_WINDOWS.map((d) => <SelectItem key={d} value={String(d)}>Expired or expiring in {d} days</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Loaded state={state} kpis={4}>
        {(ex) => {
          const expired = ex.buckets.find((b) => b.key === "expired");
          const week = ex.buckets.find((b) => b.key === "d0_7");
          return (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi label="Already expired" value={inr(expired?.value_cost ?? 0)} hint={plural(expired?.batches ?? 0, "batch", "batches")} tone={(expired?.value_cost ?? 0) > 0 ? "bad" : undefined} />
                <Kpi label="Expiring in 7 days" value={inr(week?.value_cost ?? 0)} hint={plural(week?.batches ?? 0, "batch", "batches")} />
                <Kpi k="expiry_value" value={inr(ex.totals.value_cost)} hint={`within ${ex.days} days, at cost`} />
                <Kpi label="At MRP" value={inr(ex.totals.value_mrp)} hint={`${num(ex.totals.qty_left)} pieces`} />
              </div>
              {ex.total === 0 ? (
                <NoData title={q ? "No batch matches" : `Nothing expired or expiring in ${ex.days} days`}
                  description="Only batches entered with an expiry date (on purchase or from the Stock page) are counted." />
              ) : (
                <>
                  <Section title="By time left" description={`As of ${day(ex.as_of)}. Value at latest purchase cost.`}>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={ex.buckets}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                        <YAxis tickFormatter={(v) => inrShort(Number(v))} width={60} />
                        <Tooltip formatter={(v, _n, item) => [`${inr(Number(v))} · ${num((item?.payload as { batches?: number })?.batches ?? 0)} batches`, "Value at cost"]} />
                        <Bar dataKey="value_cost" name="Value at cost" radius={[3, 3, 0, 0]}>
                          {ex.buckets.map((b) => <Cell key={b.key} fill={BUCKET_COLOR[b.key] ?? CHART_COLORS[0]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </Section>
                  <Section title="Batches" description="Pieces left is an estimate: it assumes the earliest expiry is sold first. Clear a batch on the Stock page once it's gone."
                    csv={{ filename: `dailykart-expiry-${ex.as_of}.csv`, meta: csvMeta(ctx, "Expiry", [`As of ${ex.as_of}, expired or expiring within ${ex.days} days`, "Pieces left estimated: earliest expiry sold first", `Rows ${page * size + 1} to ${page * size + ex.rows.length} of ${ex.total}`]),
                      rows: ex.rows.map((r) => ({ product: r.name, sku: r.sku, category: r.category, batch: r.batch_no, expiry: r.expiry_date, days_left: r.days_left,
                        batch_qty: r.batch_qty, stock_now: r.stock, pieces_left_est: r.qty_left, cost_price: r.cost, value_at_cost: r.value_cost, value_at_mrp: r.value_mrp })) }}>
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Product</TableHead><TableHead>Batch</TableHead><TableHead>Expiry</TableHead><TableHead className={R}>Days left</TableHead>
                        <TableHead className={R}>Batch qty</TableHead><TableHead className={R}>Left (est.)</TableHead><TableHead className={R}>Value</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {ex.rows.map((r) => (
                          <TableRow key={r.batch_id}>
                            <TableCell className="min-w-[140px]"><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{[r.sku, r.category].filter(Boolean).join(" · ")}</div></TableCell>
                            <TableCell>{r.batch_no || "—"}</TableCell>
                            <TableCell className="whitespace-nowrap">{day(r.expiry_date)}</TableCell>
                            <TableCell className={`${R} ${r.days_left < 0 ? "text-destructive font-medium" : r.days_left <= 7 ? "text-destructive" : ""}`}>
                              {r.days_left < 0 ? `${-r.days_left} days ago` : r.days_left === 0 ? "today" : num(r.days_left)}
                            </TableCell>
                            <TableCell className={R}>{num(r.batch_qty)}</TableCell>
                            <TableCell className={R}>{num(r.qty_left)}</TableCell>
                            <TableCell className={R}>{inr(r.value_cost)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <Pager page={page} size={size} total={ex.total} setPage={setPage} setSize={setSize} />
                  </Section>
                </>
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

// ---------------------------------------------------------------- stock movement
const TYPE_LABEL: Record<string, string> = {
  sale: "Sale", return: "Customer return", purchase: "Purchase", purchase_return: "Return to supplier",
  adjustment: "Adjustment", opening: "Opening stock", manual: "Manual edit",
};
const REASON_LABEL: Record<string, string> = {
  count: "Stock count", damaged: "Damaged", expired: "Expired", lost: "Lost / theft", own_use: "Own use", found: "Found", opening: "Opening", other: "Other",
};

export function StockMovementReport({ ctx }: { ctx: ReportCtx }) {
  const [missing, onMissing] = useMissing();
  const [type, setType] = useState("all");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  useEffect(() => { setPage(0); }, [q, type, ctx.run, ctx.storeId]);
  const state = useReportData(
    () => reportStockMovement(ctx.range.from, ctx.range.to, ctx.storeId, { type: type === "all" ? null : type, search: q || null, limit: size, offset: page * size }),
    [ctx.run, ctx.storeId, type, q, page, size], onMissing,
  );
  if (missing) return <NeedsUpdate />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input className="w-full sm:w-60" placeholder="Search name, SKU or barcode" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Type of change"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All changes</SelectItem>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Loaded state={state} kpis={4}>
        {(mv) => {
          const qin = mv.by_type.reduce((s, t) => s + t.qty_in, 0);
          const qout = mv.by_type.reduce((s, t) => s + t.qty_out, 0);
          const vin = mv.by_type.reduce((s, t) => s + t.value_in, 0);
          const vout = mv.by_type.reduce((s, t) => s + t.value_out, 0);
          const writtenOff = -mv.adjust_reasons.reduce((s, r) => s + r.net_value, 0);
          if (mv.by_type.length === 0) return <NoData title={q ? "No changes for this product" : "No stock changes in these dates"} />;
          return (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi k="stock_in" value={num(Math.round(qin * 1000) / 1000)} hint={`${inr(vin)} at cost`} />
                <Kpi k="stock_out" value={num(Math.round(qout * 1000) / 1000)} hint={`${inr(vout)} at cost`} />
                <Kpi k="stock_written_off" value={inr(writtenOff)} hint="adjustments, net" tone={writtenOff > 0 ? "bad" : undefined} />
                <Kpi label="Entries" value={num(mv.by_type.reduce((s, t) => s + t.entries, 0))} hint={q ? "for the search" : undefined} />
              </div>
              <div className="grid gap-4 2xl:grid-cols-2">
                <Section title="By type of change" description="Pieces and value at the cost saved with each change."
                  csv={{ filename: csvName(ctx, "stock-movement-summary"), meta: csvMeta(ctx, "Stock movement by type", q ? [`Search: ${q}`] : []),
                    rows: mv.by_type.map((t) => ({ type: TYPE_LABEL[t.key] ?? t.key, entries: t.entries, pieces_in: t.qty_in, pieces_out: t.qty_out, value_in: t.value_in, value_out: t.value_out })) }}>
                  <Table>
                    <TableHeader><TableRow><TableHead>Type</TableHead><TableHead className={R}>In</TableHead><TableHead className={R}>Out</TableHead><TableHead className={R}>Value in</TableHead><TableHead className={R}>Value out</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {mv.by_type.map((t) => (
                        <TableRow key={t.key} className="cursor-pointer" onClick={() => setType(t.key)}>
                          <TableCell>{TYPE_LABEL[t.key] ?? t.key}<div className="text-xs text-muted-foreground">{plural(t.entries, "entry", "entries")}</div></TableCell>
                          <TableCell className={R}>{t.qty_in ? num(t.qty_in) : "—"}</TableCell>
                          <TableCell className={R}>{t.qty_out ? num(t.qty_out) : "—"}</TableCell>
                          <TableCell className={R}>{t.value_in ? inr(t.value_in) : "—"}</TableCell>
                          <TableCell className={R}>{t.value_out ? inr(t.value_out) : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter><TableRow>
                      <TableCell>Total</TableCell><TableCell className={R}>{num(Math.round(qin * 1000) / 1000)}</TableCell><TableCell className={R}>{num(Math.round(qout * 1000) / 1000)}</TableCell>
                      <TableCell className={R}>{inr(vin)}</TableCell><TableCell className={R}>{inr(vout)}</TableCell>
                    </TableRow></TableFooter>
                  </Table>
                </Section>
                <Section title="Adjustments by reason" description="Negative value is stock written off; positive is stock found.">
                  {mv.adjust_reasons.length === 0 ? <p className="text-sm text-muted-foreground py-4">No stock adjustments in these dates.</p> : (
                    <Table>
                      <TableHeader><TableRow><TableHead>Reason</TableHead><TableHead className={R}>In</TableHead><TableHead className={R}>Out</TableHead><TableHead className={R}>Value</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {mv.adjust_reasons.map((r) => (
                          <TableRow key={r.key}>
                            <TableCell>{REASON_LABEL[r.key] ?? r.key}<div className="text-xs text-muted-foreground">{plural(r.entries, "entry", "entries")}</div></TableCell>
                            <TableCell className={R}>{r.qty_in ? num(r.qty_in) : "—"}</TableCell>
                            <TableCell className={R}>{r.qty_out ? num(r.qty_out) : "—"}</TableCell>
                            <TableCell className={`${R} ${r.net_value < 0 ? "text-destructive" : ""}`}>{inr(r.net_value)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Section>
              </div>
              <Section title={type === "all" ? "All stock changes" : TYPE_LABEL[type] ?? type} description="Newest first. Tap a type above to see only those."
                actions={type !== "all" ? <Button size="sm" variant="ghost" className="h-8" onClick={() => setType("all")}>Show all</Button> : undefined}
                csv={{ filename: csvName(ctx, "stock-movement"), meta: csvMeta(ctx, "Stock movement", [`Type: ${type === "all" ? "All" : TYPE_LABEL[type] ?? type}`, `Rows ${page * size + 1} to ${page * size + mv.rows.length} of ${mv.total}`, ...(q ? [`Search: ${q}`] : [])]),
                  rows: mv.rows.map((r) => ({ when: r.created_at, product: r.name, sku: r.sku, type: TYPE_LABEL[r.movement_type] ?? r.movement_type, reason: r.note ? REASON_LABEL[r.note] ?? r.note : "",
                    change: r.quantity_change, before: r.stock_before, after: r.stock_after, unit_cost: r.unit_cost ?? "", value: r.value, by: r.by_name ?? "" })) }}>
                {mv.total === 0 ? <p className="text-sm text-muted-foreground py-4">No {TYPE_LABEL[type]?.toLowerCase() ?? ""} entries in these dates.</p> : (
                  <>
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>When</TableHead><TableHead>Product</TableHead><TableHead>Type</TableHead><TableHead className={R}>Change</TableHead>
                        <TableHead className={R}>Stock after</TableHead><TableHead className={R}>Value</TableHead><TableHead>By</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {mv.rows.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="whitespace-nowrap text-xs">{dateTime(r.created_at)}</TableCell>
                            <TableCell className="min-w-[140px]"><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.sku}</div></TableCell>
                            <TableCell>{TYPE_LABEL[r.movement_type] ?? r.movement_type}{r.note && <div className="text-xs text-muted-foreground">{REASON_LABEL[r.note] ?? r.note}</div>}</TableCell>
                            <TableCell className={`${R} font-medium ${r.quantity_change < 0 ? "text-destructive" : "text-success"}`}>{r.quantity_change > 0 ? "+" : "−"}{num(Math.abs(r.quantity_change))}</TableCell>
                            <TableCell className={R}>{num(r.stock_after)}<div className="text-xs text-muted-foreground">from {num(r.stock_before)}</div></TableCell>
                            <TableCell className={R}>{r.unit_cost === null ? "—" : inr(r.value, 2)}</TableCell>
                            <TableCell className="text-xs">{r.by_name || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <Pager page={page} size={size} total={mv.total} setPage={setPage} setSize={setSize} />
                  </>
                )}
              </Section>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

// ---------------------------------------------------------------- purchases
const PURCHASE_TABS: { key: PurchaseBy; label: string }[] = [
  { key: "supplier", label: "By supplier" }, { key: "bill", label: "Bill by bill" }, { key: "category", label: "By category" },
];

export function PurchaseReport({ ctx, fixedBy }: { ctx: ReportCtx; fixedBy?: PurchaseBy }) {
  const [missing, onMissing] = useMissing();
  const [by, setBy] = useState<PurchaseBy>(fixedBy ?? "supplier");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  useEffect(() => { setPage(0); }, [q, by, ctx.run, ctx.storeId]);
  const state = useReportData(() => reportPurchases(ctx.range.from, ctx.range.to, ctx.storeId, by, { search: q || null, limit: size, offset: page * size }),
    [ctx.run, ctx.storeId, by, q, page, size], onMissing);
  // comparison period: bill totals only
  const before = useReportData(
    () => ctx.compare ? reportPurchases(ctx.compare.from, ctx.compare.to, ctx.storeId, "supplier", { limit: 1 }) : Promise.resolve({ status: "ok" as const, data: null }),
    [ctx.run, ctx.storeId, ctx.compare?.from, ctx.compare?.to], onMissing,
  );
  if (missing) return <NeedsUpdate />;
  const prev = before.status === "ok" && before.data ? before.data.totals : undefined;
  const isProduct = by === "product";
  const searchHint = by === "supplier" || by === "bill" ? "Search supplier or bill number" : "Search product, SKU or category";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {!fixedBy && (
          <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="Group purchases">
            {PURCHASE_TABS.map((t) => (
              <Button key={t.key} role="tab" aria-selected={by === t.key} size="sm" variant={by === t.key ? "default" : "ghost"} className="h-8" onClick={() => setBy(t.key)}>{t.label}</Button>
            ))}
          </div>
        )}
        <Input className="w-full sm:w-64" placeholder={searchHint} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={searchHint} />
      </div>
      <Loaded state={state} kpis={4}>
        {(pu) => {
          const t = pu.totals;
          const title = isProduct ? "Purchase by product" : PURCHASE_TABS.find((x) => x.key === by)?.label ?? "";
          return (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi k="purchases_total" value={inr(t.total)} now={t.total} before={prev?.total} compareLabel={ctx.compareLabel} hint={plural(t.bills, "bill")} />
                <Kpi k="purchase_gst" value={inr(t.tax)} hint={`on ${inr(t.taxable)}`} />
                <Kpi k="purchase_returns" value={inr(t.returns_total)} hint={t.total > 0 ? `${((t.returns_total / t.total) * 100).toFixed(1)}% of purchases` : undefined} />
                <Kpi k="supplier_paid" value={inr(t.paid)} hint={plural(t.suppliers, "supplier") + " billed"} />
              </div>
              {pu.total === 0 ? (
                <NoData title={q ? "Nothing matches the search" : "No supplier bills in these dates"} description="Purchases count on the supplier bill date." />
              ) : (
                <>
                  {page === 0 && by !== "bill" && pu.rows.length > 1 && (
                    <Section title={`Top ${Math.min(10, pu.rows.length)}`} description="With GST.">
                      <ResponsiveContainer width="100%" height={Math.max(200, Math.min(10, pu.rows.length) * 32)}>
                        <BarChart data={pu.rows.slice(0, 10).map((r) => ({ name: r.label.length > 18 ? r.label.slice(0, 17) + "…" : r.label, total: r.total }))} layout="vertical" margin={{ left: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                          <XAxis type="number" tickFormatter={(v) => inrShort(Number(v))} />
                          <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
                          <Tooltip formatter={(v) => [inr(Number(v)), "Purchases"]} />
                          <Bar dataKey="total" name="Purchases" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </Section>
                  )}
                  <Section title={title}
                    description={isProduct ? "Quantity includes free pieces. Average cost is per paid piece; cost per piece spreads the bill over free pieces too. Without GST unless marked." : "Supplier bill date. Payments and returns are by the date they were recorded."}
                    csv={{ filename: csvName(ctx, `purchases-${by}`), meta: csvMeta(ctx, `Purchases ${title.toLowerCase()}`, [`Rows ${page * size + 1} to ${page * size + pu.rows.length} of ${pu.total}`, ...(q ? [`Search: ${q}`] : [])]),
                      rows: pu.rows.map((r) => by === "supplier"
                        ? { supplier: r.label, bills: r.bills, without_gst: r.taxable, gst: r.tax, total: r.total, returns: r.returns_total, net: r.net_total, paid_in_dates: r.paid, owed_now: r.balance_now ?? "", last_bill: r.last_bill_date }
                        : by === "bill"
                          ? { bill_date: r.bill_date, bill_number: r.bill_number ?? "", supplier: r.label, lines: r.lines, without_gst: r.taxable, gst: r.tax, total: r.total }
                          : by === "category"
                            ? { category: r.label, products: r.products, lines: r.lines, quantity: r.qty, free: r.free_qty, without_gst: r.taxable, gst: r.tax, total: r.total }
                            : { product: r.label, sku: r.sku, category: r.category, lines: r.lines, quantity: r.qty, free: r.free_qty, damaged: r.damaged_qty, without_gst: r.taxable, gst: r.tax, total: r.total,
                                avg_cost: r.avg_cost ?? "", cost_per_piece: r.cost_per_piece ?? "", min_cost: r.min_cost, max_cost: r.max_cost, first_cost: r.first_cost, last_cost: r.last_cost,
                                cost_change_pct: r.cost_change_pct ?? "", cost_now: r.cost_now, last_bill: r.last_bill_date }) }}>
                    <Table>
                      {by === "supplier" && (
                        <>
                          <TableHeader><TableRow>
                            <TableHead>Supplier</TableHead><TableHead className={R}>Bills</TableHead><TableHead className={R}>Without GST</TableHead><TableHead className={R}>GST</TableHead>
                            <TableHead className={R}>Total</TableHead><TableHead className={R}>Returns</TableHead><TableHead className={R}>Paid</TableHead><TableHead className={R}>Owed now</TableHead>
                          </TableRow></TableHeader>
                          <TableBody>{pu.rows.map((r) => (
                            <TableRow key={r.key}>
                              <TableCell className="min-w-[140px]"><div className="font-medium">{r.label}</div><div className="text-xs text-muted-foreground whitespace-nowrap">last bill {day(r.last_bill_date)}</div></TableCell>
                              <TableCell className={R}>{num(r.bills)}</TableCell><TableCell className={R}>{inr(r.taxable, 2)}</TableCell><TableCell className={R}>{inr(r.tax, 2)}</TableCell>
                              <TableCell className={`${R} font-medium`}>{inr(r.total, 2)}</TableCell><TableCell className={R}>{r.returns_total ? inr(r.returns_total, 2) : "—"}</TableCell>
                              <TableCell className={R}>{r.paid ? inr(r.paid, 2) : "—"}</TableCell>
                              <TableCell className={`${R} ${(r.balance_now ?? 0) > 0 ? "text-destructive" : ""}`}>{inr(r.balance_now, 2)}</TableCell>
                            </TableRow>))}
                          </TableBody>
                        </>
                      )}
                      {by === "bill" && (
                        <>
                          <TableHeader><TableRow>
                            <TableHead>Date</TableHead><TableHead>Bill no.</TableHead><TableHead>Supplier</TableHead><TableHead className={R}>Items</TableHead>
                            <TableHead className={R}>Without GST</TableHead><TableHead className={R}>GST</TableHead><TableHead className={R}>Total</TableHead>
                          </TableRow></TableHeader>
                          <TableBody>{pu.rows.map((r) => (
                            <TableRow key={r.key}>
                              <TableCell className="whitespace-nowrap">{day(r.bill_date)}</TableCell><TableCell>{r.bill_number || "—"}</TableCell><TableCell>{r.label}</TableCell>
                              <TableCell className={R}>{num(r.lines)}</TableCell><TableCell className={R}>{inr(r.taxable, 2)}</TableCell><TableCell className={R}>{inr(r.tax, 2)}</TableCell>
                              <TableCell className={`${R} font-medium`}>{inr(r.total, 2)}</TableCell>
                            </TableRow>))}
                          </TableBody>
                        </>
                      )}
                      {by === "category" && (
                        <>
                          <TableHeader><TableRow>
                            <TableHead>Category</TableHead><TableHead className={R}>Products</TableHead><TableHead className={R}>Quantity</TableHead>
                            <TableHead className={R}>Without GST</TableHead><TableHead className={R}>GST</TableHead><TableHead className={R}>Total</TableHead>
                          </TableRow></TableHeader>
                          <TableBody>{pu.rows.map((r) => (
                            <TableRow key={r.key || "none"}>
                              <TableCell className="font-medium">{r.label}</TableCell><TableCell className={R}>{num(r.products)}</TableCell>
                              <TableCell className={R}>{num(r.qty)}{r.free_qty ? <div className="text-xs text-muted-foreground">{num(r.free_qty)} free</div> : null}</TableCell>
                              <TableCell className={R}>{inr(r.taxable, 2)}</TableCell><TableCell className={R}>{inr(r.tax, 2)}</TableCell><TableCell className={`${R} font-medium`}>{inr(r.total, 2)}</TableCell>
                            </TableRow>))}
                          </TableBody>
                        </>
                      )}
                      {isProduct && (
                        <>
                          <TableHeader><TableRow>
                            <TableHead>Product</TableHead><TableHead className={R}>Quantity</TableHead><TableHead className={R}>Without GST</TableHead>
                            <TableHead className={R}>Avg cost</TableHead><TableHead className={R}>Low – high</TableHead><TableHead className={R}>Cost change</TableHead><TableHead className={R}>Cost now</TableHead>
                          </TableRow></TableHeader>
                          <TableBody>{pu.rows.map((r) => (
                            <TableRow key={r.key}>
                              <TableCell className="min-w-[140px]"><div className="font-medium">{r.label}</div><div className="text-xs text-muted-foreground">{[r.sku, r.category].filter(Boolean).join(" · ")}</div></TableCell>
                              <TableCell className={R}>{num(r.qty)}{r.free_qty ? <div className="text-xs text-muted-foreground">{num(r.free_qty)} free</div> : null}</TableCell>
                              <TableCell className={R}>{inr(r.taxable, 2)}<div className="text-xs text-muted-foreground">{inr(r.total, 2)} with GST</div></TableCell>
                              <TableCell className={R}>{inr(r.avg_cost, 2)}</TableCell>
                              <TableCell className={`${R} text-xs whitespace-nowrap`}>{r.min_cost === r.max_cost ? inr(r.min_cost, 2) : `${inr(r.min_cost, 2)} – ${inr(r.max_cost, 2)}`}</TableCell>
                              <TableCell className={`${R} ${(r.cost_change_pct ?? 0) > 0 ? "text-destructive" : (r.cost_change_pct ?? 0) < 0 ? "text-success" : ""}`}>
                                {r.cost_change_pct === null || r.cost_change_pct === undefined ? "—" : r.cost_change_pct === 0 ? "same" : `${r.cost_change_pct > 0 ? "+" : "−"}${Math.abs(r.cost_change_pct).toFixed(1)}%`}
                              </TableCell>
                              <TableCell className={R}>{inr(r.cost_now, 2)}</TableCell>
                            </TableRow>))}
                          </TableBody>
                        </>
                      )}
                    </Table>
                    <Pager page={page} size={size} total={pu.total} setPage={setPage} setSize={setSize} />
                  </Section>
                </>
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
