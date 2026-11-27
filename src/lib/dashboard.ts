// Data and settings for the dashboard. All numbers come from the
// dashboard_metrics database function; nothing here is made up.
import { supabase } from "@/integrations/supabase/client";

export interface PeriodTotals {
  gross_sales: number; returns: number; returns_count: number; net_sales: number; tax: number; discount: number;
  bills: number; avg_bill: number; cash: number; upi: number; card: number; bank: number; credit: number; buyers: number;
  // Only for roles with the Reports permission
  cogs?: number; gross_profit?: number; net_profit?: number; expenses?: number;
}

export interface DayRow { day: string; sales: number; bills: number; returns: number; expenses?: number; cogs?: number }
export interface HourRow { hour: number; sales: number; bills: number }
export interface ProductRow { product_id: string; name: string; qty: number; revenue?: number; stock?: number; stock_value?: number }
export interface CategoryRow { category: string; revenue: number; qty: number }
export interface CustomerRow { customer_id: string; name: string; bills: number; spent: number }
export interface SupplierRow { supplier_id: string; name: string; bills: number; total: number }

export interface DashboardData {
  from: string; to: string; days: number;
  current: PeriodTotals; previous: PeriodTotals;
  daily: DayRow[]; hourly: HourRow[];
  top_products: ProductRow[]; slow_products: ProductRow[]; categories: CategoryRow[];
  top_customers: CustomerRow[];
  customers: { total: number; new: number; buying: number; returning: number; walk_in_bills: number };
  suppliers?: SupplierRow[]; purchases_total?: number;
  now: {
    customer_due: number; customers_owing: number; low_stock: number; out_of_stock: number; expiring: number; expired: number;
    supplier_due?: number; stock_value?: number;
  };
}


/** Numbers arrive as strings from Postgres numeric; turn every numeric field into a number. */
function toNumbers<T>(v: T): T {
  if (Array.isArray(v)) return v.map(toNumbers) as unknown as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = typeof x === "string" && /^-?\d+(\.\d+)?$/.test(x) && !/(_id|^name|^day|^from|^to|category)$/.test(k) ? Number(x) : toNumbers(x);
    }
    return out as T;
  }
  return v;
}

export type LoadResult = { status: "ok"; data: DashboardData } | { status: "missing" } | { status: "error"; error: unknown };

export async function loadDashboard(from: string, to: string, locationId: string | null): Promise<LoadResult> {
  const { data, error } = await supabase.rpc("dashboard_metrics" as never, { p_from: from, p_to: to, p_location_id: locationId } as never);
  if (error) {
    const e = error as { code?: string; message?: string };
    // The database update hasn't been run yet
    if (e.code === "PGRST202" || e.code === "42883" || /could not find the function|does not exist/i.test(e.message || "")) return { status: "missing" };
    return { status: "error", error };
  }
  if (!data || typeof data !== "object") return { status: "missing" };
  return { status: "ok", data: toNumbers(data as unknown as DashboardData) };
}

// ---------- Date ranges (India time)
export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "month" | "last_month" | "year" | "custom";

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today", yesterday: "Yesterday", "7d": "Last 7 days", "30d": "Last 30 days",
  month: "This month", last_month: "Last month", year: "This year", custom: "Custom dates",
};

/** Today's date in India as YYYY-MM-DD. */
export function indiaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function rangeDates(key: RangeKey, custom?: { from: string; to: string }): { from: string; to: string } {
  const t = indiaToday();
  const [y, m] = t.split("-").map(Number);
  switch (key) {
    case "today": return { from: t, to: t };
    case "yesterday": return { from: addDays(t, -1), to: addDays(t, -1) };
    case "7d": return { from: addDays(t, -6), to: t };
    case "30d": return { from: addDays(t, -29), to: t };
    case "month": return { from: `${t.slice(0, 7)}-01`, to: t };
    case "last_month": {
      const first = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
      const last = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
      return { from: first, to: last };
    }
    case "year": return { from: `${y}-01-01`, to: t };
    case "custom": return custom && custom.from && custom.to ? custom : { from: t, to: t };
  }
}

// ---------- Grouping the daily series into weeks or months
export type Grouping = "day" | "week" | "month";

export function groupDays(rows: DayRow[], by: Grouping): (DayRow & { label: string })[] {
  const fmtDay = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  if (by === "day") return rows.map((r) => ({ ...r, label: fmtDay(r.day) }));
  const map = new Map<string, DayRow & { label: string }>();
  for (const r of rows) {
    const d = new Date(r.day + "T00:00:00Z");
    let key: string;
    let label: string;
    if (by === "week") {
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      key = monday.toISOString().slice(0, 10);
      label = `Wk of ${fmtDay(key)}`;
    } else {
      key = r.day.slice(0, 7);
      label = new Date(key + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
    }
    const cur = map.get(key) || { day: key, label, sales: 0, bills: 0, returns: 0, expenses: r.expenses === undefined ? undefined : 0, cogs: r.cogs === undefined ? undefined : 0 };
    cur.sales += r.sales; cur.bills += r.bills; cur.returns += r.returns;
    if (cur.expenses !== undefined) cur.expenses += r.expenses || 0;
    if (cur.cogs !== undefined) cur.cogs += r.cogs || 0;
    map.set(key, cur);
  }
  return Array.from(map.values());
}

// ---------- Formatting
export const inr = (n: number | undefined, decimals = 0) =>
  n === undefined || Number.isNaN(n) ? "—" : `₹${n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;

export const inrShort = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${Math.round(n)}`;
};

export const count = (n: number | undefined) => (n === undefined ? "—" : n.toLocaleString("en-IN"));

/** % change, or null when there is nothing fair to compare with. */
export function change(now: number | undefined, before: number | undefined): number | null {
  if (now === undefined || before === undefined || before <= 0) return null;
  return ((now - before) / before) * 100;
}

// ---------- CSV download for a chart's numbers
export function downloadCsv(filename: string, rows: Record<string, unknown>[], meta: string[] = []) {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Stop spreadsheet formulas sneaking in through names
    const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [...meta.map((m) => esc(m)), cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))];
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Layout preferences, kept on this device per user
export interface DashboardPrefs { order: string[]; hidden: string[]; range: RangeKey; custom?: { from: string; to: string } }

const prefKey = (userId?: string) => `dailykart-dashboard-${userId || "anon"}`;

export function readPrefs(userId: string | undefined, defaults: DashboardPrefs): DashboardPrefs {
  try {
    const raw = localStorage.getItem(prefKey(userId));
    if (!raw) return defaults;
    const p = JSON.parse(raw);
    return {
      order: Array.isArray(p.order) ? p.order.filter((x: unknown) => typeof x === "string") : defaults.order,
      hidden: Array.isArray(p.hidden) ? p.hidden.filter((x: unknown) => typeof x === "string") : defaults.hidden,
      range: p.range && p.range in RANGE_LABELS ? p.range : defaults.range,
      custom: p.custom && typeof p.custom.from === "string" ? p.custom : undefined,
    };
  } catch {
    return defaults;
  }
}

export function savePrefs(userId: string | undefined, prefs: DashboardPrefs) {
  try { localStorage.setItem(prefKey(userId), JSON.stringify(prefs)); } catch { /* not remembered */ }
}

