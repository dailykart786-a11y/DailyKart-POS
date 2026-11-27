import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DateRange } from "react-day-picker";
import { AlertTriangle, CalendarRange, Clock, ListTree } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePickerWithRange } from "@/components/ui/date-picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LegacyReports } from "@/components/reports/LegacyReports";
import { ReportNav } from "@/components/reports/ReportNav";
import { Overview } from "@/components/reports/Overview";
import { ReportCtx } from "@/components/reports/context";
import { NoData } from "@/components/reports/shared";
import {
  SalesCashier, SalesCategory, SalesCredit, SalesHourly, SalesPayments, SalesReturns, SalesSummary, SalesWeekday, ProfitCategory,
} from "@/components/reports/SalesViews";
import { ExpenseSummary, ExpenseTrend, PLStatement, PLTrend } from "@/components/reports/ProfitExpenseViews";
import { CustomerAnalysis, ProductPerformance } from "@/components/reports/ProductCustomerViews";
import { PurchaseReport, StockExpiry, StockMovementReport, StockReport } from "@/components/reports/StockPurchaseViews";
import { useStore } from "@/hooks/useStore";
import { isoDate } from "@/lib/reports/api";
import { DEFAULT_REPORT, findReport } from "@/lib/reports/catalog";
import { COMPARE, CompareKey, PRESETS, PresetKey, Range, compareRange, presetRange, rangeLabel } from "@/lib/reports/dates";

const VIEWS: Record<string, (p: { ctx: ReportCtx }) => JSX.Element> = {
  "sales.summary": SalesSummary,
  "sales.hourly": SalesHourly,
  "sales.weekday": SalesWeekday,
  "sales.payments": SalesPayments,
  "sales.category": SalesCategory,
  "sales.cashier": SalesCashier,
  "sales.returns": SalesReturns,
  "sales.credit": SalesCredit,
  "pl.statement": PLStatement,
  "pl.trend": PLTrend,
  "pl.category": ProfitCategory,
  "pl.product": ({ ctx }) => <ProductPerformance ctx={ctx} defaultSort="profit" />,
  "product.performance": ProductPerformance,
  "customer.analysis": CustomerAnalysis,
  "exp.summary": ExpenseSummary,
  "exp.trend": ExpenseTrend,
  "product.movers": ({ ctx }) => <StockReport ctx={ctx} mode="movers" />,
  "stock.valuation": ({ ctx }) => <StockReport ctx={ctx} mode="valuation" />,
  "stock.expiry": StockExpiry,
  "stock.movement": StockMovementReport,
  "purchase.summary": ({ ctx }) => <PurchaseReport ctx={ctx} />,
  "purchase.product": ({ ctx }) => <PurchaseReport ctx={ctx} fixedBy="product" />,
};

const toPicker = (r: Range): DateRange => ({ from: new Date(r.from + "T00:00:00"), to: new Date(r.to + "T00:00:00") });

export default function Reports() {
  const { filterStoreId, stores } = useStore();
  const [params, setParams] = useSearchParams();
  const reportId = findReport(params.get("r")) ? (params.get("r") as string) : DEFAULT_REPORT;
  const report = findReport(reportId)!;

  // What the owner is choosing (draft) and what the reports show (applied, on Generate)
  const [preset, setPreset] = useState<PresetKey>("30d");
  const [custom, setCustom] = useState<DateRange | undefined>(() => toPicker(presetRange("30d")));
  const [compareKey, setCompareKey] = useState<CompareKey>("previous");
  const [applied, setApplied] = useState(() => ({ range: presetRange("30d"), compareKey: "previous" as CompareKey, presetLabel: "Last 30 days" }));
  const [run, setRun] = useState(0);
  const [missing, setMissing] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const draftRange = useMemo(() => presetRange(preset, custom?.from ? { from: isoDate(custom.from), to: isoDate(custom.to ?? custom.from) } : undefined), [preset, custom]);
  const dirty = draftRange.from !== applied.range.from || draftRange.to !== applied.range.to || compareKey !== applied.compareKey;

  const generate = () => {
    setApplied({ range: draftRange, compareKey, presetLabel: PRESETS.find((p) => p.key === preset)?.label ?? "" });
    setRun((n) => n + 1);
  };

  const open = useCallback((id: string) => {
    setParams((p) => { const n = new URLSearchParams(p); n.set("r", id); return n; }, { replace: false });
    setNavOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [setParams]);
  const onMissing = useCallback(() => setMissing(true), []);

  const compare = compareRange(applied.range, applied.compareKey);
  const ctx: ReportCtx = {
    range: applied.range,
    compare,
    compareLabel: compare ? (applied.compareKey === "last_year" ? "same dates last year" : "the previous period") : "",
    storeId: filterStoreId,
    storeName: filterStoreId ? stores.find((s) => s.id === filterStoreId)?.name ?? "One store" : stores.length > 1 ? "All stores" : stores[0]?.name ?? "All stores",
    run,
    open,
    onMissing,
  };

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

  const View = VIEWS[reportId];
  const nav = <ReportNav current={reportId} onPick={open} />;

  return (
    <Layout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-bold">Reports</h1>
            <p className="text-muted-foreground text-sm md:text-base">Sales, profit, expenses and more, worked out from your bills, returns, purchases and expenses.</p>
          </div>
        </div>

        {/* Dates and comparison */}
        <Card>
          <CardContent className="pt-4 pb-4 flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-auto sm:min-w-[190px]">
              <label className="text-sm font-medium mb-1.5 flex items-center gap-1.5" htmlFor="rep-preset"><CalendarRange className="h-4 w-4" /> Dates</label>
              <Select value={preset} onValueChange={(v) => { setPreset(v as PresetKey); if (v !== "custom") setCustom(toPicker(presetRange(v as PresetKey))); }}>
                <SelectTrigger id="rep-preset"><SelectValue /></SelectTrigger>
                <SelectContent>{PRESETS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {preset === "custom" && (
              <div className="w-full sm:w-auto">
                <span className="text-sm font-medium mb-1.5 block">From – to</span>
                <DatePickerWithRange date={custom} setDate={setCustom} />
              </div>
            )}
            <div className="w-full sm:w-auto sm:min-w-[190px]">
              <label className="text-sm font-medium mb-1.5 block" htmlFor="rep-compare">Compare with</label>
              <Select value={compareKey} onValueChange={(v) => setCompareKey(v as CompareKey)}>
                <SelectTrigger id="rep-compare"><SelectValue /></SelectTrigger>
                <SelectContent>{COMPARE.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={generate} className="w-full sm:w-auto" variant={dirty ? "default" : "outline"}>
              {dirty ? "Generate report" : "Refresh"}
            </Button>
            <div className="w-full text-xs text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Showing {rangeLabel(applied.range)}{compare ? `, compared with ${rangeLabel(compare)}` : ""} · {ctx.storeName} · India time
              {dirty && <span className="text-warning-foreground bg-warning/20 rounded px-1.5 py-0.5 ml-1">Press Generate to apply new dates</span>}
            </div>
          </CardContent>
        </Card>

        <Overview ctx={ctx} />

        <div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto pr-1">{nav}</div>
          </aside>
          <section className="min-w-0 space-y-4" aria-labelledby="report-title">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{report.category.title}</p>
                <h2 id="report-title" className="text-xl font-semibold">{report.title}</h2>
                <p className="text-sm text-muted-foreground">{report.about}</p>
              </div>
              <Sheet open={navOpen} onOpenChange={setNavOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="sm" className="lg:hidden gap-1.5 shrink-0"><ListTree className="h-4 w-4" /> All reports</Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[300px] overflow-y-auto">
                  <SheetHeader><SheetTitle>Reports</SheetTitle></SheetHeader>
                  <div className="mt-4">{nav}</div>
                </SheetContent>
              </Sheet>
            </div>
            {View && !report.phase ? (
              <View key={reportId} ctx={ctx} />
            ) : (
              <NoData title="Coming soon" description={`This report is being built${report.phase ? ` (phase ${report.phase} of the reports upgrade)` : ""}. Everything it shows will come from your real records.`} />
            )}
          </section>
        </div>
      </div>
    </Layout>
  );
}
