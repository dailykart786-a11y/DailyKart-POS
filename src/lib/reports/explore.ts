// The sales explorer keeps its grouping and filters in the page link, so a
// drill-down can be bookmarked, shared or saved (Phase 9).
import type { ExploreFilters, ExploreGroup } from "./api";

export interface ExploreState extends ExploreFilters {
  group: ExploreGroup;
  /** Names shown on the filter chips for ids. */
  productName?: string | null;
  customerName?: string | null;
  cashierName?: string | null;
  /** A narrower date range picked by drilling into a day, week or month. */
  from?: string | null;
  to?: string | null;
}

const KEYS: [keyof ExploreState, string][] = [
  ["group", "g"], ["category", "xc"], ["productId", "xp"], ["productName", "xpn"], ["cashierId", "xu"], ["cashierName", "xun"],
  ["customerId", "xcu"], ["customerName", "xcun"], ["customerType", "xt"], ["method", "xm"], ["from", "xf"], ["to", "xto"],
];
const GROUPS: ExploreGroup[] = ["day", "week", "month", "hour", "weekday", "category", "product", "cashier", "customer", "payment"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

export function readExplore(p: URLSearchParams): ExploreState {
  const g = p.get("g") as ExploreGroup | null;
  const t = p.get("xt");
  const id = (k: string) => (UUID.test(p.get(k) ?? "") ? p.get(k) : null);
  const d = (k: string) => (ISO.test(p.get(k) ?? "") ? p.get(k) : null);
  const from = d("xf"), to = d("xto");
  return {
    group: g && GROUPS.includes(g) ? g : "category",
    category: p.get("xc") || null,
    productId: id("xp"), productName: p.get("xpn"),
    cashierId: id("xu"), cashierName: p.get("xun"),
    customerId: id("xcu"), customerName: p.get("xcun"),
    customerType: t === "walkin" || t === "registered" ? t : "all",
    method: p.get("xm") || null,
    from: from && to ? from : null, to: from && to ? to : null,
  };
}

/** Writes the explorer state into a copy of the page's search params. */
export function writeExplore(p: URLSearchParams, s: ExploreState): URLSearchParams {
  const n = new URLSearchParams(p);
  for (const [, k] of KEYS) n.delete(k);
  for (const [field, k] of KEYS) {
    const v = s[field];
    if (v && !(field === "customerType" && v === "all")) n.set(k, String(v));
  }
  return n;
}

/** What one click on a row of each grouping drills into. */
export const DRILL_NEXT: Partial<Record<ExploreGroup, ExploreGroup>> = {
  day: "product", week: "day", month: "day", category: "product", product: "day", cashier: "category", customer: "product", payment: "category",
};

export const GROUP_LABEL: Record<ExploreGroup, string> = {
  day: "Day", week: "Week", month: "Month", hour: "Hour of day", weekday: "Day of the week",
  category: "Category", product: "Product", cashier: "Staff member", customer: "Customer", payment: "Payment method",
};
