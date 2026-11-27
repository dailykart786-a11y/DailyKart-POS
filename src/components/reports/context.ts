import { useEffect, useRef, useState } from "react";
import type { ReportResult } from "@/lib/reports/api";
import type { Range } from "@/lib/reports/dates";
import { rangeLabel } from "@/lib/reports/dates";

/** What every report view gets from the page. */
export interface ReportCtx {
  range: Range;
  compare: Range | null;
  compareLabel: string;
  storeId: string | null;
  storeName: string;
  /** Bumped by Generate; views reload when it changes. */
  run: number;
  open: (reportId: string) => void;
  onMissing: () => void;
}

/** Header lines for a CSV, so the file says what it is. */
export function csvMeta(ctx: ReportCtx, title: string, extra: string[] = []): string[] {
  return [
    `DailyKart · ${title}`,
    `Dates: ${rangeLabel(ctx.range)} (India time)`,
    `Store: ${ctx.storeName}`,
    "Amounts in INR",
    ...extra,
    `Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
  ];
}

export const csvName = (ctx: ReportCtx, slug: string) => `dailykart-${slug}-${ctx.range.from}-to-${ctx.range.to}.csv`;

export type DataState<T> = { status: "loading" } | { status: "ok"; data: T } | { status: "error"; error: unknown };

/**
 * Loads one report's data. Reloads when any key changes. Ignores answers that
 * arrive after a newer request, so a slow old query can't overwrite new data.
 */
export function useReportData<T>(load: () => Promise<ReportResult<T>>, keys: unknown[], onMissing: () => void): DataState<T> & { reload: () => void } {
  const [state, setState] = useState<DataState<T>>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    setState({ status: "loading" });
    load().then((r) => {
      if (mine !== seq.current) return;
      if (r.status === "missing") { onMissing(); return; }
      setState(r.status === "ok" ? { status: "ok", data: r.data } : { status: "error", error: r.error });
    }).catch((e) => { if (mine === seq.current) setState({ status: "error", error: e }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...keys, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

/** Load two things together (e.g. this period and the comparison period). */
export async function both<A, B>(a: Promise<ReportResult<A>>, b: Promise<ReportResult<B>> | null): Promise<ReportResult<{ a: A; b: B | null }>> {
  const [ra, rb] = await Promise.all([a, b ?? Promise.resolve(null)]);
  if (ra.status !== "ok") return ra;
  if (rb && rb.status !== "ok") return rb;
  return { status: "ok", data: { a: ra.data, b: rb ? (rb as { data: B }).data : null } };
}
