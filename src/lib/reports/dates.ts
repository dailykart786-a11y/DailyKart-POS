// Date ranges for reports, always as India calendar dates (YYYY-MM-DD).
import { indiaToday } from "@/lib/dashboard";

export type PresetKey =
  | "today" | "yesterday" | "7d" | "15d" | "30d" | "this_week" | "last_week" | "this_month" | "last_month"
  | "this_quarter" | "this_year" | "last_year" | "this_fy" | "last_fy" | "custom";

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "15d", label: "Last 15 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_quarter", label: "This quarter" },
  { key: "this_year", label: "This year" },
  { key: "last_year", label: "Last year" },
  { key: "this_fy", label: "This financial year" },
  { key: "last_fy", label: "Last financial year" },
  { key: "custom", label: "Custom dates" },
];

export type CompareKey = "none" | "previous" | "last_year";

export const COMPARE: { key: CompareKey; label: string }[] = [
  { key: "previous", label: "Previous period" },
  { key: "last_year", label: "Same dates last year" },
  { key: "none", label: "No comparison" },
];

export interface Range { from: string; to: string }

const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Days in a range, counting both ends. */
export function dayCount(r: Range): number {
  return Math.round((Date.parse(r.to + "T00:00:00Z") - Date.parse(r.from + "T00:00:00Z")) / 86400000) + 1;
}

export function presetRange(key: PresetKey, custom?: Range, today = indiaToday()): Range {
  const [y, m] = today.split("-").map(Number);
  const dow = (new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7; // Monday = 0
  const fyStart = m >= 4 ? y : y - 1; // Indian financial year starts 1 April
  switch (key) {
    case "today": return { from: today, to: today };
    case "yesterday": return { from: addDays(today, -1), to: addDays(today, -1) };
    case "7d": return { from: addDays(today, -6), to: today };
    case "15d": return { from: addDays(today, -14), to: today };
    case "30d": return { from: addDays(today, -29), to: today };
    case "this_week": return { from: addDays(today, -dow), to: today };
    case "last_week": return { from: addDays(today, -dow - 7), to: addDays(today, -dow - 1) };
    case "this_month": return { from: ymd(y, m, 1), to: today };
    case "last_month": return { from: ymd(y, m - 1, 1), to: ymd(y, m, 0) };
    case "this_quarter": {
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: ymd(y, qm, 1), to: today };
    }
    case "this_year": return { from: ymd(y, 1, 1), to: today };
    case "last_year": return { from: ymd(y - 1, 1, 1), to: ymd(y - 1, 12, 31) };
    case "this_fy": return { from: ymd(fyStart, 4, 1), to: today };
    case "last_fy": return { from: ymd(fyStart - 1, 4, 1), to: ymd(fyStart, 3, 31) };
    case "custom": return custom && custom.from && custom.to ? (custom.from <= custom.to ? custom : { from: custom.to, to: custom.from }) : { from: today, to: today };
  }
}

/** The period to compare with, or null. "Previous" is the same number of days just before. */
export function compareRange(r: Range, key: CompareKey): Range | null {
  if (key === "none") return null;
  if (key === "previous") {
    const n = dayCount(r);
    return { from: addDays(r.from, -n), to: addDays(r.from, -1) };
  }
  const back = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    // 29 Feb maps to 28 Feb in a non-leap year
    const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
    return ymd(y - 1, m, Math.min(d, last));
  };
  return { from: back(r.from), to: back(r.to) };
}

export function rangeLabel(r: Range): string {
  const f = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return r.from === r.to ? f(r.from) : `${f(r.from)} – ${f(r.to)}`;
}
