import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarRange, ChevronDown, Plus, RefreshCw, Settings2, ShoppingCart, Users, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CardGridSkeleton, ChartSkeleton, ErrorState } from "@/components/feedback";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/hooks/useStore";
import { useUserRole } from "@/hooks/useUserRole";
import { friendlyError } from "@/lib/friendlyError";
import { logError } from "@/lib/errorLog";
import {
  RANGE_LABELS, indiaToday, loadDashboard, rangeDates, readPrefs, savePrefs,
  type DashboardData, type DashboardPrefs, type RangeKey,
} from "@/lib/dashboard";
import { DEFAULT_HIDDEN, DEFAULT_ORDER, KPIS } from "./kpis";
import { KpiCard } from "./KpiCard";
import { CustomizeDialog } from "./CustomizeDialog";
import { DashboardCharts } from "./DashboardCharts";
import {
  BusyHours, CategoryShare, HeroSales, InventoryWatch, PaymentMix, ProfitGauge, RecentBills, SalesTrend, TopProducts,
} from "./OverviewPanels";

/** Panels a person can switch off in Customise. */
const SECTIONS = [
  { id: "hero", label: "Sales summary" },
  { id: "payments", label: "How customers paid" },
  { id: "highlights", label: "Key numbers" },
  { id: "trend", label: "Sales over time" },
  { id: "profit", label: "Profit gauge" },
  { id: "top_products", label: "Top selling products" },
  { id: "inventory", label: "Inventory watch" },
  { id: "categories", label: "Sales by category" },
  { id: "recent_bills", label: "Recent bills" },
  { id: "busy_hours", label: "Busy hours" },
  { id: "detailed", label: "Detailed charts" },
];
const HIGHLIGHTS = 4;

const DEFAULT_PREFS: DashboardPrefs = { order: DEFAULT_ORDER, hidden: DEFAULT_HIDDEN, range: "today", hiddenSections: [], moreOpen: false };

interface Props {
  /** Called when the database update for this dashboard hasn't been run yet. */
  onMissing: () => void;
}

/** The owner's dashboard: real numbers for any date range, charts, and a layout each person can arrange. */
export function BusinessDashboard({ onMissing }: Props) {
  const { user } = useAuth();
  const { filterStoreId, stores } = useStore();
  const { hasPermission, role } = useUserRole();
  const [prefs, setPrefs] = useState<DashboardPrefs>(() => readPrefs(user?.id, DEFAULT_PREFS));
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const lastLoad = useRef(0);
  const seq = useRef(0);

  useEffect(() => { setPrefs(readPrefs(user?.id, DEFAULT_PREFS)); }, [user?.id]);
  const update = (p: DashboardPrefs) => { setPrefs(p); savePrefs(user?.id, p); };

  const { from, to } = rangeDates(prefs.range, prefs.custom);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    lastLoad.current = Date.now();
    const res = await loadDashboard(from, to, filterStoreId);
    if (mine !== seq.current) return; // a newer request is on its way
    setLoading(false);
    if (res.status === "missing") { onMissing(); return; }
    if (res.status === "error") { logError("Dashboard load", res.error); setError(res.error); return; }
    setData(res.data);
    setUpdatedAt(new Date());
  }, [from, to, filterStoreId, onMissing]);

  useEffect(() => { load(); }, [load]);

  // Fresh numbers when the person comes back to the app, at most once a minute.
  // No timers or live subscriptions: they use up the free database allowance.
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible" && Date.now() - lastLoad.current > 60000) load(); };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => { document.removeEventListener("visibilitychange", onFocus); window.removeEventListener("focus", onFocus); };
  }, [load]);

  // Cards in the saved order (new cards added later go to the end)
  const ordered = useMemo(() => {
    const known = prefs.order.filter((id) => KPIS.some((k) => k.id === id));
    const missing = KPIS.filter((k) => !known.includes(k.id)).map((k) => k.id);
    return [...known, ...missing].map((id) => KPIS.find((k) => k.id === id)!);
  }, [prefs.order]);
  const available = data ? ordered.filter((k) => k.value(data) !== undefined) : ordered;
  const visible = available.filter((k) => !prefs.hidden.includes(k.id));

  const storeLabel = filterStoreId ? stores.find((s) => s.id === filterStoreId)?.name || "This store" : stores.length > 1 ? "All stores" : stores[0]?.name || "Store";
  const days = data?.days ?? 1;
  const periodLabel = days === 1 ? "day" : `${days} days`;
  const today = indiaToday();
  const fe = error ? friendlyError(error, "Couldn't load the dashboard") : null;
  const hiddenSections = prefs.hiddenSections ?? [];
  const show = (id: string) => !hiddenSections.includes(id);
  const showProfit = show("profit") && data?.current.gross_profit !== undefined;
  // Numbers already in the sales summary aren't repeated as key numbers
  const inHero = ["gross_sales", "bills", "avg_bill", "net_sales", data?.current.gross_profit !== undefined ? "gross_profit" : ""];
  const cardPool = show("hero") ? visible.filter((k) => !inHero.includes(k.id)) : visible;
  const highlights = show("highlights") ? cardPool.slice(0, HIGHLIGHTS) : [];
  const rest = cardPool.filter((k) => !highlights.includes(k));
  const rangeText = prefs.range === "custom" && data ? (data.from === data.to ? fmt(data.from) : `${fmt(data.from)} – ${fmt(data.to)}`) : RANGE_LABELS[prefs.range];

  return (
    <div className="space-y-5">
      {/* Title and controls */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting()}{user?.user_metadata?.full_name ? `, ${String(user.user_metadata.full_name).split(" ")[0]}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            {storeLabel} · {prefs.range === "today" ? "Today" : RANGE_LABELS[prefs.range]}
            {data && data.from !== data.to ? ` (${fmt(data.from)} – ${fmt(data.to)})` : data ? ` (${fmt(data.from)})` : ""}
            {updatedAt && <> · updated {updatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={prefs.range} onValueChange={(v) => update({ ...prefs, range: v as RangeKey, custom: v === "custom" ? prefs.custom || { from: rangeDates("7d").from, to: today } : prefs.custom })}>
            <SelectTrigger className="h-9 w-[150px]" aria-label="Date range">
              <CalendarRange className="h-4 w-4 mr-1 shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => <SelectItem key={k} value={k}>{RANGE_LABELS[k]}</SelectItem>)}
            </SelectContent>
          </Select>
          {prefs.range === "custom" && (
            <div className="flex items-center gap-1">
              <Input type="date" className="h-9 w-[140px]" value={from} max={to} aria-label="From date"
                onChange={(e) => e.target.value && update({ ...prefs, custom: { from: e.target.value, to } })} />
              <span className="text-muted-foreground text-sm">to</span>
              <Input type="date" className="h-9 w-[140px]" value={to} min={from} max={today} aria-label="To date"
                onChange={(e) => e.target.value && update({ ...prefs, custom: { from, to: e.target.value } })} />
            </div>
          )}
          <Button variant="outline" size="sm" className="h-9 gap-2" onClick={load} disabled={loading} aria-label="Refresh numbers">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> <span className="hidden sm:inline">Refresh</span>
          </Button>
          <CustomizeDialog
            cards={available}
            hidden={prefs.hidden}
            onChange={(order, hidden) => update({ ...prefs, order: [...order, ...prefs.order.filter((id) => !order.includes(id))], hidden })}
            onReset={() => update({ ...DEFAULT_PREFS, range: prefs.range, custom: prefs.custom })}
            sections={SECTIONS.filter((x) => x.id !== "profit" || data?.current.gross_profit !== undefined)}
            hiddenSections={hiddenSections}
            onSectionsChange={(h) => update({ ...prefs, hiddenSections: h })}
          />
        </div>
      </div>

      {/* Quick actions, only those this person can use */}
      <div className="flex flex-wrap gap-2">
        {hasPermission("sales") && <Button asChild size="sm" className="gap-2"><Link to="/sales"><ShoppingCart className="h-4 w-4" /> New sale</Link></Button>}
        {hasPermission("products") && <Button asChild size="sm" variant="outline" className="gap-2"><Link to="/products"><Plus className="h-4 w-4" /> Products</Link></Button>}
        {hasPermission("customers") && <Button asChild size="sm" variant="outline" className="gap-2"><Link to="/customers"><Users className="h-4 w-4" /> Customers</Link></Button>}
        {hasPermission("reports") && <Button asChild size="sm" variant="outline" className="gap-2"><Link to="/reports"><BarChart3 className="h-4 w-4" /> Reports</Link></Button>}
        {(role === "admin" || role === "manager") && <Button asChild size="sm" variant="ghost" className="gap-2"><Link to="/settings"><Settings2 className="h-4 w-4" /> Shop settings</Link></Button>}
      </div>

      {fe && !data && (
        <Card><CardContent className="p-0"><ErrorState code={fe.code} title={fe.title} description={fe.description} onRetry={load} compact /></CardContent></Card>
      )}
      {fe && data && (
        <p className="text-sm text-destructive" role="alert">{fe.title}. Showing the last numbers loaded. <button className="underline" onClick={load}>Try again</button></p>
      )}

      {!data && loading ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="lg:col-span-8 h-72 rounded-2xl bg-muted animate-pulse" />
            <div className="lg:col-span-4 h-72 rounded-2xl bg-muted animate-pulse" />
          </div>
          <CardGridSkeleton count={4} />
          <Card><CardContent className="pt-6"><ChartSkeleton /></CardContent></Card>
        </div>
      ) : data && (
        <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {/* Sales summary and payment mix */}
          {(show("hero") || show("payments")) && (
            <div className="grid gap-4 lg:grid-cols-12">
              {show("hero") && <div className={show("payments") ? "lg:col-span-8" : "lg:col-span-12"}><HeroSales data={data} periodLabel={periodLabel} rangeLabel={rangeText} /></div>}
              {show("payments") && <div className={show("hero") ? "lg:col-span-4" : "lg:col-span-12"}><PaymentMix data={data} /></div>}
            </div>
          )}

          {/* A few key numbers; the rest are one click away */}
          {show("highlights") && (visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">All number cards are hidden. Use Customise to show some.</p>
          ) : (
            <div className="grid gap-2 sm:gap-3 grid-cols-2 xl:grid-cols-4">
              {highlights.map((k) => (
                <KpiCard key={k.id} kpi={k} data={data} periodLabel={periodLabel} canOpen={!k.linkPermission || hasPermission(k.linkPermission)} />
              ))}
            </div>
          ))}

          {/* Trend and profit */}
          {(show("trend") || showProfit) && (
            <div className="grid gap-4 lg:grid-cols-12">
              {show("trend") && <SalesTrend data={data} className={showProfit ? "lg:col-span-8" : "lg:col-span-12"} />}
              {showProfit && <ProfitGauge data={data} className={show("trend") ? "lg:col-span-4" : "lg:col-span-12"} />}
            </div>
          )}

          {/* Products, stock and categories */}
          {(show("top_products") || show("inventory") || show("categories")) && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {show("top_products") && <TopProducts data={data} canOpen={hasPermission("reports")} />}
              {show("inventory") && <InventoryWatch data={data} storeId={filterStoreId} canOpen={hasPermission("stock")} />}
              {show("categories") && <CategoryShare data={data} />}
            </div>
          )}

          {/* Latest bills and busy hours */}
          {((show("recent_bills") && hasPermission("sales")) || show("busy_hours")) && (
            <div className="grid gap-4 lg:grid-cols-12">
              {show("recent_bills") && hasPermission("sales") && (
                <RecentBills storeId={filterStoreId} refreshKey={updatedAt?.toISOString() || ""} className={show("busy_hours") ? "lg:col-span-7" : "lg:col-span-12"} />
              )}
              {show("busy_hours") && <BusyHours data={data} className={show("recent_bills") && hasPermission("sales") ? "lg:col-span-5" : "lg:col-span-12"} />}
            </div>
          )}

          {/* Every number card */}
          {rest.length > 0 && (
            <div>
              <Button variant="ghost" size="sm" className="gap-2 px-2" aria-expanded={!!prefs.moreOpen} onClick={() => update({ ...prefs, moreOpen: !prefs.moreOpen })}>
                <ChevronDown className={`h-4 w-4 transition-transform ${prefs.moreOpen ? "rotate-180" : ""}`} />
                {prefs.moreOpen ? "Hide more numbers" : `Show ${rest.length} more numbers`}
              </Button>
              {prefs.moreOpen && (
                <div className="mt-2 grid gap-2 sm:gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {rest.map((k) => (
                    <KpiCard key={k.id} kpi={k} data={data} periodLabel={periodLabel} canOpen={!k.linkPermission || hasPermission(k.linkPermission)} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Detailed charts with grouping and CSV */}
          {show("detailed") && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Detailed charts</h2>
              <DashboardCharts key={`${data.from}-${data.to}`} data={data} rangeLabel={RANGE_LABELS[prefs.range]} storeLabel={storeLabel} hasPermission={hasPermission} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const fmt = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
