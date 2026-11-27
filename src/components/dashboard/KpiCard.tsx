import { useNavigate } from "react-router-dom";
import { Info, TrendingDown, TrendingUp } from "lucide-react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { change, count, inr, type DashboardData } from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import type { KpiDef } from "./kpis";

interface Props {
  kpi: KpiDef;
  data: DashboardData;
  canOpen: boolean;
  periodLabel: string;
}

/** One number tile: value, fair comparison with the previous period, small trend, explanation, click-through. */
export function KpiCard({ kpi, data, canOpen, periodLabel }: Props) {
  const navigate = useNavigate();
  const value = kpi.value(data);
  if (value === undefined) return null; // not available for this role
  const before = kpi.previous?.(data);
  const pct = kpi.previous ? change(value, before) : null;
  const good = pct === null ? null : kpi.lowerIsBetter ? pct <= 0 : pct >= 0;
  const spark = kpi.spark && data.daily.length > 1 ? data.daily.map((r) => ({ v: kpi.spark!(r) ?? 0 })) : null;
  const Icon = kpi.icon;
  const warn = kpi.warnIfPositive && value > 0;
  const shown = kpi.format === "money" ? inr(value) : count(value);

  const open = () => canOpen && navigate(kpi.link);

  return (
    <Card
      role={canOpen ? "link" : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={open}
      onKeyDown={(e) => { if (canOpen && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } }}
      aria-label={`${kpi.label}: ${shown}`}
      className={cn(
        "relative overflow-hidden transition-shadow",
        canOpen && "cursor-pointer hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        warn && "border-warning/60",
      )}
    >
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs sm:text-sm text-muted-foreground leading-tight">{kpi.label}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={(e) => e.stopPropagation()} className="text-muted-foreground/70 hover:text-foreground shrink-0" aria-label={`What is ${kpi.label}?`}>
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{kpi.help}</TooltipContent>
            </Tooltip>
          </div>
          <div className={cn("rounded-md p-1.5 shrink-0 hidden min-[380px]:block", warn ? "bg-warning/15 text-warning-foreground dark:text-warning" : "bg-primary/10 text-primary dark:bg-muted dark:text-foreground")}>
            <Icon className="h-4 w-4" aria-hidden />
          </div>
        </div>
        <div className="mt-1 text-lg sm:text-2xl font-semibold tracking-tight tabular-nums truncate" data-no-translate>{shown}</div>
        <div className="mt-1 flex items-end justify-between gap-2 min-h-[28px]">
          <div className="text-[11px] sm:text-xs leading-snug">
            {kpi.previous ? (
              pct !== null ? (
                <span className={cn("inline-flex flex-wrap items-center gap-x-1 font-medium", good ? "text-success" : "text-destructive")}>
                  {pct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {/* A huge % from a tiny earlier figure says little; show the earlier figure instead */}
                  {Math.abs(pct) >= 1000
                    ? <>up from {kpi.format === "money" ? inr(before) : count(before)}</>
                    : Math.abs(pct) < 0.05 ? "0%" : `${Math.abs(pct).toFixed(1)}%`}
                  <span className="font-normal text-muted-foreground">vs prev. {periodLabel}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">Nothing in the previous {periodLabel} to compare</span>
              )
            ) : kpi.id === "customers" ? (
              <span className="text-muted-foreground">{count(data.customers.new)} new in this period</span>
            ) : kpi.id === "customer_due" ? (
              <span className="text-muted-foreground">{count(data.now.customers_owing)} customers owe</span>
            ) : kpi.id === "expiring" && data.now.expired > 0 ? (
              <span className="text-destructive font-medium">{count(data.now.expired)} already expired</span>
            ) : (
              <span className="text-muted-foreground">Right now</span>
            )}
          </div>
          {spark && (
            <div className="hidden sm:block h-7 w-20 shrink-0" aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={spark}>
                  <Line type="monotone" dataKey="v" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
