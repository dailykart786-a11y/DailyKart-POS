// The visual overview at the top of the dashboard. Every number comes from
// dashboard_metrics or, for the two short lists, a small read of the database.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area, AreaChart, Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { AlertTriangle, ArrowRight, CalendarClock, PackageX, Receipt, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/feedback";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/lib/errorLog";
import { change, count, inr, inrShort, type DashboardData } from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import { BRAND, SERIES, axisStyle, darkTooltipStyle, tooltipStyle } from "./theme";

const money = (v: unknown) => inr(Number(v));
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;
const dayLabel = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });

function Panel({ title, description, action, className, children }: {
  title: string; description?: string; action?: React.ReactNode; className?: string; children: React.ReactNode;
}) {
  return (
    <Card className={cn("flex flex-col rounded-2xl shadow-sm", className)}>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 gap-2">
        <div className="min-w-0">
          <CardTitle className="text-base font-semibold">{title}</CardTitle>
          {description && <CardDescription className="text-xs">{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent className="flex-1">{children}</CardContent>
    </Card>
  );
}

const ViewAll = ({ to, label = "View all" }: { to: string; label?: string }) => (
  <Link to={to} className="inline-flex items-center gap-1 text-xs font-medium text-primary dark:text-foreground hover:underline shrink-0">
    {label} <ArrowRight className="h-3 w-3" />
  </Link>
);

function ChangePill({ pct, before, dark }: { pct: number | null; before?: number; dark?: boolean }) {
  if (pct === null) return <span className={cn("text-xs", dark ? "text-white/60" : "text-muted-foreground")}>No earlier figures to compare</span>;
  const up = pct >= 0;
  const text = Math.abs(pct) >= 1000 ? `up from ${inr(before)}` : `${Math.abs(pct).toFixed(1)}%`;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
      up ? (dark ? "bg-emerald-400/15 text-emerald-300" : "bg-success/10 text-success") : (dark ? "bg-rose-400/15 text-rose-300" : "bg-destructive/10 text-destructive"),
    )}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />} {text}
    </span>
  );
}

/** Points for a trend chart: by hour for one day, otherwise by day. */
function trendPoints(data: DashboardData) {
  if (data.days === 1) {
    const used = data.hourly.filter((h) => h.sales > 0 || h.bills > 0).map((h) => h.hour);
    const start = Math.min(8, ...used);
    const end = Math.max(21, ...used);
    return data.hourly.filter((h) => h.hour >= start && h.hour <= end).map((h) => ({ label: hourLabel(h.hour), sales: h.sales, bills: h.bills }));
  }
  return data.daily.map((d) => ({ label: dayLabel(d.day), sales: d.sales, bills: d.bills }));
}

// ---------- Hero: sales summary on the logo's navy, with a gold trend
export function HeroSales({ data, periodLabel, rangeLabel }: { data: DashboardData; periodLabel: string; rangeLabel: string }) {
  const c = data.current;
  const pct = change(c.gross_sales, data.previous.gross_sales);
  const points = useMemo(() => trendPoints(data), [data]);
  const hasSales = points.some((p) => p.sales > 0);
  const stats = [
    { label: "Bills", value: count(c.bills) },
    { label: "Average bill", value: inr(c.avg_bill) },
    { label: "Net sales", value: inr(c.net_sales) },
    ...(c.gross_profit !== undefined ? [{ label: "Gross profit", value: inr(c.gross_profit) }] : [{ label: "Customers", value: count(c.buyers) }]),
  ];
  return (
    <div className="relative overflow-hidden rounded-2xl p-4 sm:p-6 text-white shadow-md"
      style={{ background: `linear-gradient(135deg, ${BRAND.navy} 0%, ${BRAND.navyLight} 100%)` }}>
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full opacity-[0.12] blur-3xl" style={{ background: BRAND.gold }} aria-hidden />
      <div className="relative flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: BRAND.goldSoft }}>Sales summary · {rangeLabel}</span>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-3xl sm:text-4xl font-bold tracking-tight tabular-nums" data-no-translate>{inr(c.gross_sales)}</span>
          <ChangePill pct={pct} before={data.previous.gross_sales} dark />
        </div>
        <span className="text-xs text-white/60">Gross sales, GST included{pct !== null ? ` · vs previous ${periodLabel}` : ""}</span>
      </div>
      <div className="relative mt-3 h-36 sm:h-44 -mx-2" aria-label="Sales trend">
        {hasSales ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="heroGold" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BRAND.gold} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={BRAND.gold} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.55)" }} axisLine={false} tickLine={false} minTickGap={16} />
              <YAxis hide />
              <Tooltip {...darkTooltipStyle} formatter={(v: number, n: string) => [n === "sales" ? inr(v) : count(v), n === "sales" ? "Sales" : "Bills"]} />
              <Area type="monotone" dataKey="sales" stroke={BRAND.gold} strokeWidth={2.5} fill="url(#heroGold)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/60">No sales yet in this period</div>
        )}
      </div>
      <div className="relative mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-white/[0.07] px-3 py-2 ring-1 ring-white/10">
            <div className="text-[11px] text-white/60">{s.label}</div>
            <div className="text-sm sm:text-base font-semibold tabular-nums truncate" data-no-translate>{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Payment mix donut
export function PaymentMix({ data }: { data: DashboardData }) {
  const c = data.current;
  const rows = [
    { name: "Cash", value: c.cash }, { name: "UPI", value: c.upi }, { name: "Card", value: c.card },
    { name: "Bank", value: c.bank }, { name: "Udhaar", value: c.credit },
  ].filter((r) => r.value > 0);
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <Panel title="How customers paid" description="Money taken in this period by method">
      {total === 0 ? <EmptyState title="No payments yet" description="Payments appear here as bills are made." className="py-8" /> : (
        <div className="flex flex-col items-center gap-3">
          <div className="relative h-44 w-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={rows} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="100%" paddingAngle={2} stroke="none" isAnimationActive={false}>
                  {rows.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
                </Pie>
                <Tooltip {...tooltipStyle} formatter={money} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[11px] text-muted-foreground">Total</span>
              <span className="text-lg font-bold tabular-nums" data-no-translate>{inrShort(total)}</span>
            </div>
          </div>
          <ul className="w-full space-y-1.5 text-sm">
            {rows.map((r, i) => (
              <li key={r.name} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: SERIES[i % SERIES.length] }} />
                <span className="flex-1 text-muted-foreground">{r.name}</span>
                <span className="tabular-nums font-medium" data-no-translate>{inr(r.value)}</span>
                <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{Math.round((r.value / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

// ---------- Sales and bills trend
export function SalesTrend({ data, className }: { data: DashboardData; className?: string }) {
  const points = useMemo(() => trendPoints(data), [data]);
  const has = points.some((p) => p.sales > 0);
  return (
    <Panel className={className} title={data.days === 1 ? "Sales through the day" : "Sales over time"}
      description={data.days === 1 ? "Sales and bills by hour" : "Sales and bills by day"}
      action={<div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: SERIES[0] }} />Sales</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: SERIES[1] }} />Bills</span>
      </div>}>
      {!has ? <EmptyState title="No sales in this period" description="Try a longer date range." className="py-10" /> : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id="trendNavy" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={axisStyle} axisLine={false} tickLine={false} minTickGap={16} />
              <YAxis yAxisId="s" tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={inrShort} width={52} />
              <YAxis yAxisId="b" orientation="right" tick={axisStyle} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
              <Tooltip {...tooltipStyle} formatter={(v: number, n: string) => [n === "sales" ? inr(v) : count(v), n === "sales" ? "Sales" : "Bills"]} />
              <Area yAxisId="s" type="monotone" dataKey="sales" stroke={SERIES[0]} strokeWidth={2.5} fill="url(#trendNavy)" isAnimationActive={false} />
              <Area yAxisId="b" type="monotone" dataKey="bills" stroke={SERIES[1]} strokeWidth={2} fill="none" strokeDasharray="5 4" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

// ---------- Profit gauge (only for roles that can see profit)
export function ProfitGauge({ data, className }: { data: DashboardData; className?: string }) {
  const c = data.current;
  if (c.gross_profit === undefined || c.cogs === undefined) return null;
  const revenue = c.gross_profit + c.cogs; // sales after GST and returns
  const margin = revenue > 0 ? Math.max(0, Math.min(100, (c.gross_profit / revenue) * 100)) : null;
  const color = margin === null ? SERIES[7] : margin >= 15 ? SERIES[2] : margin >= 5 ? SERIES[1] : SERIES[4];
  return (
    <Panel className={className} title="Profit" description="Gross margin = profit ÷ sales after GST and returns">
      {margin === null ? <EmptyState title="No sales to work out profit" className="py-8" /> : (
        <div className="flex flex-col items-center">
          <div className="relative h-32 w-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={[{ v: margin }, { v: 100 - margin }]} dataKey="v" startAngle={180} endAngle={0} cy="100%"
                  innerRadius="120%" outerRadius="160%" stroke="none" isAnimationActive={false}>
                  <Cell fill={color} />
                  <Cell fill="hsl(var(--muted))" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
              <span className="text-2xl font-bold tabular-nums">{margin.toFixed(1)}%</span>
              <span className="text-[11px] text-muted-foreground">gross margin</span>
            </div>
          </div>
          <dl className="mt-4 w-full grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-muted/60 p-2"><dt className="text-[11px] text-muted-foreground">Gross profit</dt><dd className="text-sm font-semibold tabular-nums" data-no-translate>{inrShort(c.gross_profit)}</dd></div>
            <div className="rounded-xl bg-muted/60 p-2"><dt className="text-[11px] text-muted-foreground">Expenses</dt><dd className="text-sm font-semibold tabular-nums" data-no-translate>{inrShort(c.expenses ?? 0)}</dd></div>
            <div className="rounded-xl bg-muted/60 p-2"><dt className="text-[11px] text-muted-foreground">Net profit</dt><dd className={cn("text-sm font-semibold tabular-nums", (c.net_profit ?? 0) < 0 && "text-destructive")} data-no-translate>{inrShort(c.net_profit ?? 0)}</dd></div>
          </dl>
        </div>
      )}
    </Panel>
  );
}

// ---------- Top selling products
export function TopProducts({ data, canOpen }: { data: DashboardData; canOpen: boolean }) {
  const rows = data.top_products.slice(0, 6);
  const max = Math.max(1, ...rows.map((r) => r.revenue ?? r.qty));
  return (
    <Panel title="Top selling products" description="By sales value in this period" action={canOpen ? <ViewAll to="/reports" label="Reports" /> : undefined}>
      {rows.length === 0 ? <EmptyState title="Nothing sold yet" className="py-8" /> : (
        <ol className="space-y-3">
          {rows.map((r, i) => (
            <li key={r.product_id} className="flex items-center gap-3">
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold",
                i === 0 ? "text-[#13213a]" : "bg-muted text-muted-foreground")} style={i === 0 ? { background: BRAND.gold } : undefined}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">{r.name}</span>
                  <span className="text-sm font-semibold tabular-nums shrink-0" data-no-translate>{r.revenue !== undefined ? inr(r.revenue) : count(r.qty)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${((r.revenue ?? r.qty) / max) * 100}%`, background: SERIES[0] }} />
                  </div>
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{count(r.qty)} sold{r.stock !== undefined ? ` · ${count(r.stock)} left` : ""}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

// ---------- Inventory watch: counts from the metrics, plus the items lowest on stock
interface LowItem { id: string; name: string; stock_quantity: number | null; min_stock_level: number | null; base_unit: string | null }

export function InventoryWatch({ data, storeId, canOpen }: { data: DashboardData; storeId: string | null; canOpen: boolean }) {
  const [items, setItems] = useState<LowItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => {
      // Lowest stock first; keep the ones at or below their reorder level.
      let q = supabase.from("products").select("id, name, stock_quantity, min_stock_level, base_unit")
        .eq("is_active", true).order("stock_quantity", { ascending: true }).limit(40);
      if (storeId) q = q.eq("location_id", storeId);
      const { data: rows, error } = await q;
      if (!live) return;
      if (error) { logError("Dashboard low stock", error); setFailed(true); setItems([]); return; }
      setItems(((rows || []) as LowItem[]).filter((p) => (p.stock_quantity ?? 0) <= (p.min_stock_level ?? 0)).slice(0, 5));
    })();
    return () => { live = false; };
  }, [storeId, data.now.low_stock, data.now.out_of_stock]);

  const chips = [
    { label: "Low stock", value: data.now.low_stock, icon: AlertTriangle, tone: "text-amber-600 dark:text-amber-400 bg-amber-500/10" },
    { label: "Out of stock", value: data.now.out_of_stock, icon: PackageX, tone: "text-red-600 dark:text-red-400 bg-red-500/10" },
    { label: "Expiring", value: data.now.expiring, icon: CalendarClock, tone: "text-sky-600 dark:text-sky-400 bg-sky-500/10" },
  ];
  return (
    <Panel title="Inventory watch" description="Items at or below their reorder level" action={canOpen ? <ViewAll to="/stock" /> : undefined}>
      <div className="grid grid-cols-3 gap-2">
        {chips.map((c) => (
          <div key={c.label} className={cn("rounded-xl px-2 py-2 text-center", c.tone)}>
            <c.icon className="mx-auto h-4 w-4" aria-hidden />
            <div className="text-lg font-bold tabular-nums leading-tight">{count(c.value)}</div>
            <div className="text-[11px] leading-tight">{c.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-3">
        {items === null ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : failed ? (
          <p className="text-xs text-muted-foreground">Couldn't load the item list.</p>
        ) : items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">All items are above their reorder level.</p>
        ) : (
          <ul className="divide-y">
            {items.map((p) => {
              const stock = p.stock_quantity ?? 0;
              return (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="truncate text-sm">{p.name}</span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", stock <= 0 ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400")}>
                    {stock <= 0 ? "Out" : `${count(stock)} ${p.base_unit || ""}`.trim()} <span className="font-normal opacity-70">/ {count(p.min_stock_level ?? 0)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}

// ---------- Category share
export function CategoryShare({ data }: { data: DashboardData }) {
  const rows = data.categories.slice(0, 6);
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  return (
    <Panel title="Sales by category" description="Share of sales value">
      {total === 0 ? <EmptyState title="No category sales yet" className="py-8" /> : (
        <div className="flex flex-col gap-3">
          <div className="flex h-3 w-full overflow-hidden rounded-full">
            {rows.map((r, i) => <div key={r.category} style={{ width: `${(r.revenue / total) * 100}%`, background: SERIES[i % SERIES.length] }} title={r.category} />)}
          </div>
          <ul className="space-y-2 text-sm">
            {rows.map((r, i) => (
              <li key={r.category} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: SERIES[i % SERIES.length] }} />
                <span className="flex-1 truncate text-muted-foreground">{r.category || "Uncategorised"}</span>
                <span className="tabular-nums font-medium" data-no-translate>{inr(r.revenue)}</span>
                <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{Math.round((r.revenue / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

// ---------- Busy hours
export function BusyHours({ data, className }: { data: DashboardData; className?: string }) {
  const rows = data.hourly.filter((h) => h.hour >= 6 && h.hour <= 23).map((h) => ({ label: hourLabel(h.hour), bills: h.bills, sales: h.sales }));
  const peak = rows.reduce((m, r) => (r.bills > m.bills ? r : m), { label: "", bills: 0, sales: 0 });
  return (
    <Panel className={className} title="Busy hours" description={peak.bills > 0 ? `Busiest at ${peak.label}` : "Bills by hour of day"}>
      {peak.bills === 0 ? <EmptyState title="No bills in this period" className="py-8" /> : (
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 0, left: -24, bottom: 0 }}>
              <XAxis dataKey="label" tick={axisStyle} axisLine={false} tickLine={false} interval={2} />
              <YAxis tick={axisStyle} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip {...tooltipStyle} cursor={{ fill: "hsl(var(--muted))" }} formatter={(v: number, n: string) => [n === "sales" ? inr(v) : count(v), n === "sales" ? "Sales" : "Bills"]} />
              <Bar dataKey="bills" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                {rows.map((r) => <Cell key={r.label} fill={r.label === peak.label ? BRAND.gold : SERIES[0]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

// ---------- Recent bills
interface RecentBill { id: string; invoice_number: string; total_amount: number; payment_method: string | null; status: string | null; created_at: string; customers: { name: string } | null }
const PAY: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", credit: "Udhaar", bank: "Bank", split: "Split" };

export function RecentBills({ storeId, refreshKey, className }: { storeId: string | null; refreshKey: string; className?: string }) {
  const [rows, setRows] = useState<RecentBill[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => {
      let q = supabase.from("sales").select("id, invoice_number, total_amount, payment_method, status, created_at, customers(name)")
        .order("created_at", { ascending: false }).limit(6);
      if (storeId) q = q.eq("location_id", storeId);
      const { data, error } = await q;
      if (!live) return;
      if (error) { logError("Dashboard recent bills", error); setFailed(true); setRows([]); return; }
      setRows((data || []) as unknown as RecentBill[]);
    })();
    return () => { live = false; };
  }, [storeId, refreshKey]);

  return (
    <Panel className={className} title="Recent bills" description="The latest bills made, newest first" action={<ViewAll to="/sales" />}>
      {rows === null ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : failed ? (
        <p className="text-sm text-muted-foreground">Couldn't load recent bills.</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={Receipt} title="No bills yet" className="py-8" />
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-2 py-2 font-medium">Bill</th>
                <th className="px-2 py-2 font-medium">Customer</th>
                <th className="px-2 py-2 font-medium hidden sm:table-cell">Time</th>
                <th className="px-2 py-2 font-medium">Paid by</th>
                <th className="px-2 py-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((b) => {
                const cancelled = b.status && b.status !== "completed";
                return (
                  <tr key={b.id} className={cn(cancelled && "opacity-60")}>
                    <td className="px-2 py-2.5 font-medium whitespace-nowrap">{b.invoice_number}</td>
                    <td className="px-2 py-2.5 max-w-[9rem] truncate text-muted-foreground">{b.customers?.name || "Walk-in"}</td>
                    <td className="px-2 py-2.5 hidden sm:table-cell whitespace-nowrap text-muted-foreground">
                      {new Date(b.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{cancelled ? (b.status === "cancelled" ? "Cancelled" : b.status) : PAY[b.payment_method || ""] || b.payment_method || "—"}</span>
                    </td>
                    <td className="px-2 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap" data-no-translate>{inr(Number(b.total_amount))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
