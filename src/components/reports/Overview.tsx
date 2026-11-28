// The 12 headline figures at the top of the Reports page. Every number comes
// from report_period / report_position; the comparison uses the same function
// for the comparison dates. Clicking a card opens the report behind it.
import { AlertTriangle, BadgeIndianRupee, Boxes, Receipt, RotateCcw, ShoppingCart, TrendingUp, Truck, Users, Wallet, Scale, PiggyBank } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PeriodReport, PositionReport, ReportResult, reportPeriod, reportPosition } from "@/lib/reports/api";
import { COST_MISSING_NOTE } from "@/lib/reports/definitions";
import { ReportCtx, useReportData } from "./context";
import { Kpi, Loaded, inr, num } from "./shared";

export function Overview({ ctx }: { ctx: ReportCtx }) {
  const state = useReportData(async (): Promise<ReportResult<{ cur: PeriodReport; prev: PeriodReport | null; pos: PositionReport }>> => {
    const [cur, prev, pos] = await Promise.all([
      reportPeriod(ctx.range.from, ctx.range.to, ctx.storeId),
      ctx.compare ? reportPeriod(ctx.compare.from, ctx.compare.to, ctx.storeId) : Promise.resolve(null),
      reportPosition(ctx.storeId),
    ]);
    if (cur.status !== "ok") return cur;
    if (prev && prev.status !== "ok") return prev;
    if (pos.status !== "ok") return pos;
    return { status: "ok", data: { cur: cur.data, prev: prev ? prev.data : null, pos: pos.data } };
  }, [ctx.run, ctx.storeId], ctx.onMissing);

  return (
    <section aria-labelledby="overview-heading" className="space-y-3">
      <h2 id="overview-heading" className="sr-only">Overview</h2>
      <Loaded state={state} kpis={12}>
        {({ cur, prev, pos }) => {
          const c = (n: number | null | undefined) => (prev ? n : undefined);
          const cmp = { compareLabel: ctx.compareLabel };
          return (
            <>
              {cur.cost_missing_lines > 0 && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{cur.cost_missing_lines} bill lines ({inr(cur.cost_missing_value)}) have no saved cost and are left out of profit. {COST_MISSING_NOTE}</AlertDescription>
                </Alert>
              )}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                <Kpi k="gross_sales" icon={ShoppingCart} value={inr(cur.gross_sales)} now={cur.gross_sales} before={c(prev?.gross_sales)} {...cmp} onClick={() => ctx.open("sales.summary")} />
                <Kpi k="net_sales" icon={TrendingUp} value={inr(cur.net_sales)} now={cur.net_sales} before={c(prev?.net_sales)} {...cmp} onClick={() => ctx.open("sales.summary")} />
                <Kpi k="bills" icon={Receipt} value={num(cur.bills)} now={cur.bills} before={c(prev?.bills)} money={false} {...cmp} onClick={() => ctx.open("sales.hourly")} />
                <Kpi k="avg_bill" icon={Scale} value={inr(cur.avg_bill)} now={cur.avg_bill} before={c(prev?.avg_bill)} {...cmp} onClick={() => ctx.open("sales.summary")} />
                <Kpi k="gross_profit" icon={BadgeIndianRupee} value={inr(cur.gross_profit)} now={cur.gross_profit} before={c(prev?.gross_profit)} {...cmp}
                  hint={cur.gross_margin !== null ? `${cur.gross_margin.toFixed(1)}% margin` : undefined} onClick={() => ctx.open("pl.statement")} />
                <Kpi k="net_profit" icon={PiggyBank} value={inr(cur.net_profit)} now={cur.net_profit} before={c(prev?.net_profit)} {...cmp}
                  tone={cur.net_profit < 0 ? "bad" : undefined} onClick={() => ctx.open("pl.statement")} />
                <Kpi k="expenses" icon={Wallet} value={inr(cur.expenses)} now={cur.expenses} before={c(prev?.expenses)} lowerIsBetter {...cmp} onClick={() => ctx.open("exp.summary")} />
                <Kpi k="purchases_total" icon={Truck} value={inr(cur.purchases_total)} now={cur.purchases_total} before={c(prev?.purchases_total)} {...cmp}
                  hint={cur.purchases_count ? `${cur.purchases_count} bills` : undefined} onClick={() => ctx.open("purchase.summary")} />
                <Kpi k="returns" icon={RotateCcw} value={inr(cur.returns)} now={cur.returns} before={c(prev?.returns)} lowerIsBetter {...cmp}
                  hint={cur.returns_count ? `${cur.returns_count} returns` : undefined} onClick={() => ctx.open("sales.returns")} />
                <Kpi k="customer_outstanding" icon={Users} value={inr(pos.customer_outstanding)} hint={`${pos.customers_owing} customers · now`} onClick={() => ctx.open("khata.ageing")} />
                <Kpi k="supplier_outstanding" icon={Truck} value={inr(pos.supplier_outstanding)} hint={`${pos.suppliers_owed} suppliers · now`} onClick={() => ctx.open("purchase.summary")} />
                <Kpi k="inventory_value" icon={Boxes} value={inr(pos.inventory_value)} hint={`${num(pos.sku_count)} products · now`} onClick={() => ctx.open("stock.valuation")} />
              </div>
              {prev && <p className="text-xs text-muted-foreground">Changes compare with {ctx.compareLabel}. Dues and stock value are as of now, not for the dates picked.</p>}
            </>
          );
        }}
      </Loaded>
    </section>
  );
}
