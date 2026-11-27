// Report numbers, worked out in the database by the report_* functions
// (supabase/migrations/20261127420000_reports_core.sql). The page, its charts
// and its exports all read from these, so they always show the same figures.
import { supabase } from "@/integrations/supabase/client";

export type ReportResult<T> = { status: "ok"; data: T } | { status: "missing" } | { status: "error"; error: unknown };

export interface PeriodReport {
  from: string; to: string;
  gross_sales: number; discounts: number; taxable_sales: number; returns: number; returns_count: number;
  net_sales: number; gst_collected: number; gst_on_sales: number; gst_on_returns: number;
  billed_total: number; refunds_total: number; net_billed: number;
  bills: number; avg_bill: number | null; units_sold: number; buyers: number;
  collect_cash: number; collect_upi: number; collect_card: number; collect_bank: number;
  khata_cash: number; khata_upi: number; khata_card: number; khata_bank: number; khata_payments: number;
  refund_cash: number; refund_upi: number; refund_card: number; refund_khata: number;
  credit_sales: number; split_bills: number;
  cogs: number; cost_missing_lines: number; cost_missing_value: number;
  gross_profit: number; gross_margin: number | null;
  expenses: number; expenses_count: number; stock_written_off: number; other_income: number; other_expense: number;
  net_profit: number; net_margin: number | null;
  purchases_taxable: number; purchases_tax: number; purchases_total: number; purchases_count: number;
  purchase_returns_total: number; purchase_returns_tax: number; purchase_returns_count: number; net_purchases: number;
}

export interface PositionReport {
  as_of: string;
  customer_outstanding: number; customer_advance: number; customers_owing: number;
  supplier_outstanding: number; suppliers_owed: number;
  inventory_value: number; inventory_mrp_value: number; sku_count: number; stock_units: number;
  out_of_stock: number; low_stock: number;
}

export type Grain = "day" | "week" | "month" | "year" | "hour";

export interface TrendRow {
  bucket: string; bills: number; billed_total: number; gross_sales: number; discounts: number; tax: number;
  returns: number; net_sales: number; cogs: number; cost_missing_value: number; gross_profit: number; expenses: number;
}

export interface ProductReportRow {
  product_id: string; name: string; sku: string | null; barcode: string | null; category: string | null; hsn_code: string | null;
  units: number; revenue: number; discount: number; bills: number; returned_qty: number; returned_value: number;
  net_revenue: number; cogs: number | null; cost_missing_value: number; profit: number | null; margin: number | null;
  stock_quantity: number | null; price: number | null; mrp: number | null; cost_price: number | null;
}
export interface ProductReport {
  total: number;
  totals: { units: number; revenue: number; returned_value: number; net_revenue: number; cogs: number; profit: number; cost_missing_value: number };
  rows: ProductReportRow[];
}

export interface CustomerReportRow {
  customer_id: string; name: string; phone: string | null; bills: number; spend: number; refunds: number; net_spend: number;
  avg_bill: number | null; first_at: string | null; last_at: string | null; is_new: boolean; due: number; loyalty_points: number | null;
}
export interface CustomerReport {
  total: number; new_customers: number; returning_customers: number; repeat_customers: number; walk_in_bills: number;
  rows: CustomerReportRow[];
}

export interface ExpenseReport {
  total: number; count: number; recurring_total: number; from_till_total: number;
  pending_count: number; pending_total: number; rejected_count: number;
  by_category: { category: string; amount: number; count: number }[];
  by_method: { method: string; amount: number; count: number }[];
}

const TEXT_KEYS = /(_id|^name|^phone|^sku|^barcode|^category|^hsn_code|^bucket|^from|^to|^method|_at|^as_of)$/;

/** Postgres numeric arrives as text; turn the number fields into numbers. */
export function toNumbers<T>(v: T): T {
  if (Array.isArray(v)) return v.map(toNumbers) as unknown as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = typeof x === "string" && /^-?\d+(\.\d+)?$/.test(x) && !TEXT_KEYS.test(k) ? Number(x) : toNumbers(x);
    }
    return out as T;
  }
  return v;
}

export function isMissingFunction(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function|does not exist/i.test(e.message || ""));
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<ReportResult<T>> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) return isMissingFunction(error) ? { status: "missing" } : { status: "error", error };
  if (data === null || data === undefined) return { status: "missing" };
  return { status: "ok", data: toNumbers(data as unknown as T) };
}

export const reportPeriod = (from: string, to: string, locationId: string | null) =>
  call<PeriodReport>("report_period", { p_from: from, p_to: to, p_location_id: locationId });

export const reportPosition = (locationId: string | null) =>
  call<PositionReport>("report_position", { p_location_id: locationId });

export const reportTrend = (from: string, to: string, locationId: string | null, grain: Grain) =>
  call<TrendRow[]>("report_trend", { p_from: from, p_to: to, p_location_id: locationId, p_grain: grain });

export const reportProducts = (
  from: string, to: string, locationId: string | null,
  opts: { category?: string | null; search?: string | null; sort?: string; dir?: "asc" | "desc"; limit?: number; offset?: number } = {},
) =>
  call<ProductReport>("report_products", {
    p_from: from, p_to: to, p_location_id: locationId,
    p_category: opts.category ?? null, p_search: opts.search ?? null,
    p_sort: opts.sort ?? "revenue", p_dir: opts.dir ?? "desc",
    p_limit: opts.limit ?? 25, p_offset: opts.offset ?? 0,
  });

export const reportCustomers = (
  from: string, to: string, locationId: string | null,
  opts: { search?: string | null; sort?: string; dir?: "asc" | "desc"; limit?: number; offset?: number } = {},
) =>
  call<CustomerReport>("report_customers", {
    p_from: from, p_to: to, p_location_id: locationId, p_search: opts.search ?? null,
    p_sort: opts.sort ?? "spend", p_dir: opts.dir ?? "desc",
    p_limit: opts.limit ?? 25, p_offset: opts.offset ?? 0,
  });

export const reportExpenses = (from: string, to: string, locationId: string | null) =>
  call<ExpenseReport>("report_expenses", { p_from: from, p_to: to, p_location_id: locationId });

/** Picks a sensible chart grouping for a date range. */
export function grainFor(from: string, to: string): Grain {
  const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (days <= 62) return "day";
  if (days <= 400) return "month";
  return "year";
}

/** A local calendar date (from the date picker) as YYYY-MM-DD, without shifting it to UTC. */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
