// Small building blocks shared by every report view.
import { useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Download, FileDown, FileSpreadsheet, FileText, Info, Loader2, Minus, Printer } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { downloadCsv, inr as inrBase } from "@/lib/dashboard";
import { KPI } from "@/lib/reports/definitions";
import { cn } from "@/lib/utils";
import { CardGridSkeleton, ChartSkeleton, EmptyState, ErrorState } from "@/components/feedback";
import { friendlyError } from "@/lib/friendlyError";

/** ₹ amount with a proper minus sign in front (−₹50, not ₹-50). */
export const inr = (n: number | null | undefined, decimals = 0) => {
  if (n === null || n === undefined) return "—";
  const r = Math.round(n * 10 ** decimals) / 10 ** decimals;
  // -0 and amounts that round to zero show as ₹0, never ₹-0
  return r < 0 ? `−${inrBase(-r, decimals)}` : inrBase(Math.abs(r), decimals);
};

export const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toFixed(1)}%`);

export const num = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-IN"));

/**
 * Change against the comparison period. No % when the earlier figure is zero
 * or negative (there's nothing fair to divide by): "new" or "—" instead.
 */
export function changeOf(now: number | null | undefined, before: number | null | undefined) {
  if (now === null || now === undefined || before === null || before === undefined) return null;
  const diff = now - before;
  const pctChange = before > 0 ? (diff / before) * 100 : null;
  return { diff, pct: pctChange, newFromZero: before === 0 && now !== 0 };
}

export function ChangeBadge({ now, before, money = true, lowerIsBetter = false, label }: {
  now: number | null | undefined; before: number | null | undefined; money?: boolean; lowerIsBetter?: boolean; label?: string;
}) {
  const c = changeOf(now, before);
  if (!c) return null;
  const up = c.diff > 0.004;
  const down = c.diff < -0.004;
  const good = lowerIsBetter ? down : up;
  const bad = lowerIsBetter ? up : down;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  const diffText = money ? inr(Math.abs(c.diff)) : num(Math.abs(Math.round(c.diff * 100) / 100));
  const text = !up && !down ? "No change" : c.pct !== null ? `${c.pct > 0 ? "+" : "−"}${Math.abs(c.pct).toFixed(1)}%` : c.newFromZero ? "New" : `${up ? "+" : "−"}${diffText}`;
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-xs font-medium", good && "text-success", bad && "text-destructive", !good && !bad && "text-muted-foreground")}
      title={`${up ? "Up" : down ? "Down" : "Same"} ${diffText}${label ? ` vs ${label}` : ""}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {text}
    </span>
  );
}

export function InfoTip({ k, how, source }: { k?: string; how?: string; source?: string }) {
  const def = k ? KPI[k] : undefined;
  const text = how ?? def?.how;
  if (!text) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label="How this is worked out" className="text-muted-foreground hover:text-foreground">
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{text}</p>
        {(source ?? def?.source) && <p className="mt-1 text-xs opacity-80">From: {source ?? def?.source}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

/** One figure in a card, with its definition, optional comparison and optional click-through. */
export function Kpi({ k, label, value, now, before, money = true, lowerIsBetter, compareLabel, tone, icon: Icon, onClick, hint }: {
  k?: string; label?: string; value: string; now?: number | null; before?: number | null; money?: boolean;
  lowerIsBetter?: boolean; compareLabel?: string; tone?: "good" | "bad"; icon?: React.ComponentType<{ className?: string }>;
  onClick?: () => void; hint?: string;
}) {
  const title = label ?? (k ? KPI[k]?.label : undefined) ?? k ?? "";
  const body = (
    <CardContent className="pt-4 pb-4">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {Icon && <Icon className="h-4 w-4" />}
        <span className="truncate">{title}</span>
        <InfoTip k={k} />
      </div>
      <div className={cn("text-xl md:text-2xl font-bold mt-1 tabular-nums", tone === "bad" && "text-destructive", tone === "good" && "text-success")}>{value}</div>
      <div className="mt-1 min-h-[1rem] flex items-center gap-2">
        {before !== undefined && <ChangeBadge now={now} before={before} money={money} lowerIsBetter={lowerIsBetter} label={compareLabel} />}
        {hint && <span className="text-xs text-muted-foreground truncate">{hint}</span>}
      </div>
    </CardContent>
  );
  return onClick ? (
    <Card role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className="cursor-pointer transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Card>
  ) : <Card>{body}</Card>;
}

type CsvExport = { filename: string; rows: Record<string, unknown>[]; meta: string[]; all?: () => Promise<Record<string, unknown>[]> };

/**
 * Download or print what a table shows: CSV, Excel, PDF or print, each with
 * the report's title, dates, store and filters on top. When the table is paged
 * on the server, `all` fetches every row so the file isn't just one page.
 */
export function ExportMenu({ title, csv }: { title: string; csv: CsvExport }) {
  const [busy, setBusy] = useState(false);
  const run = async (kind: "csv" | "xlsx" | "pdf" | "print", whole: boolean) => {
    setBusy(true);
    try {
      const rows = whole && csv.all ? await csv.all() : csv.rows;
      const meta = whole && csv.all ? csv.meta.filter((m) => !/^Rows \d+ to \d+ of/.test(m)).concat(`All ${rows.length} rows`) : csv.meta;
      const t = { name: csv.filename.replace(/\.csv$/i, ""), meta, rows };
      if (kind === "csv") downloadCsv(csv.filename, rows, meta);
      else if (kind === "xlsx") (await import("@/lib/export/xlsx")).downloadXlsx(t);
      else if (kind === "pdf") await (await import("@/lib/export/pdf")).downloadPdf(t);
      else (await import("@/lib/export/print")).printTable(t);
    } catch (e) {
      const f = friendlyError(e, "Couldn't export");
      toast({ title: f.title, description: f.description, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  const items = (whole: boolean) => (
    <>
      <DropdownMenuItem onSelect={() => run("xlsx", whole)}><FileSpreadsheet className="h-4 w-4 mr-2" />Excel (.xlsx)</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => run("csv", whole)}><FileText className="h-4 w-4 mr-2" />CSV</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => run("pdf", whole)}><FileDown className="h-4 w-4 mr-2" />PDF</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => run("print", whole)}><Printer className="h-4 w-4 mr-2" />Print</DropdownMenuItem>
    </>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-1 h-8" disabled={busy} aria-label={`Export ${title}`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} <span className="hidden sm:inline">Export</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {csv.all ? (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">This page</DropdownMenuLabel>
            {items(false)}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">All rows</DropdownMenuLabel>
            {items(true)}
          </>
        ) : items(false)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A titled card for a chart or table, with an optional CSV download of exactly what it shows. */
export function Section({ title, description, children, csv, className, actions }: {
  title: string; description?: string; children: ReactNode; className?: string; actions?: ReactNode;
  csv?: CsvExport;
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {actions}
          {csv && csv.rows.length > 0 && <ExportMenu title={title} csv={csv} />}
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">{children}</CardContent>
    </Card>
  );
}

export const CHART_COLORS = [
  "hsl(var(--primary))", "hsl(var(--success))", "hsl(var(--warning))", "hsl(var(--accent))",
  "hsl(var(--destructive))", "hsl(var(--muted-foreground))",
];

export const METHOD_LABEL: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", bank: "Bank", credit: "Udhaar (credit)" };

export const fmtBucket = (b: string, grain?: string) => {
  if (/^\d{2}:00$/.test(b)) return b;
  const d = new Date(b + "T00:00:00");
  if (grain === "month") return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
  if (grain === "year") return String(d.getFullYear());
  if (grain === "week") return `Wk ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

/** Shows a skeleton while loading, a friendly error with retry, or the content. */
export function Loaded<T>({ state, children, kpis = 4 }: {
  state: { status: "loading" } | { status: "ok"; data: T } | { status: "error"; error: unknown };
  children: (data: T) => ReactNode; kpis?: number;
}) {
  if (state.status === "loading") return <div className="space-y-4"><CardGridSkeleton count={kpis} /><ChartSkeleton /></div>;
  if (state.status === "error") {
    const f = friendlyError(state.error, "Couldn't load this report");
    return <Card><CardContent><ErrorState compact title={f.title} description={f.description} /></CardContent></Card>;
  }
  return <>{children(state.data)}</>;
}

export function NoData({ title, description }: { title: string; description?: string }) {
  return <Card><CardContent><EmptyState title={title} description={description} /></CardContent></Card>;
}
