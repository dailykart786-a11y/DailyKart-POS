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

const TEXT_KEYS = /(_id|^key|^label|^name|^phone|^sku|^barcode|^category|^hsn_code|^bucket|^from|^to|^method|_at|^as_of|_date|^batch_no|^bill_number|^note|^movement|^movement_type|^stock_status|^source_type|^by_name|^by|^ref|^kind|^bucket|^cashier|^party|^note|^phone|^hsn|^description|^job_title)$/;

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

export type BreakdownBy = "category" | "cashier" | "weekday";

export interface BreakdownRow {
  key: string; label: string; bills: number; units: number; gross_sales: number; discounts: number;
  returns: number; return_count: number; net_sales: number; gst: number; avg_bill: number | null;
  cogs: number; cost_missing_value: number; gross_profit: number; gross_margin: number | null;
}

export interface PaymentRow { key: string; label: string; amount: number; bills: number; split_parts: number }

export const reportBreakdown = (from: string, to: string, locationId: string | null, by: BreakdownBy) =>
  call<BreakdownRow[]>("report_breakdown", { p_from: from, p_to: to, p_location_id: locationId, p_by: by });

export const reportPayments = (from: string, to: string, locationId: string | null) =>
  call<PaymentRow[]>("report_breakdown", { p_from: from, p_to: to, p_location_id: locationId, p_by: "payment" });

// ---------------------------------------------------------------- Phase 4: stock and purchases
// (supabase/migrations/20261127440000_reports_stock_purchases.sql)
export type StockFilter = "all" | "in" | "low" | "out" | "dead" | "fast" | "slow";
export type Movement = "fast" | "normal" | "slow" | "dead" | "none";

export interface InventoryRow {
  product_id: string; name: string; sku: string | null; barcode: string | null; category: string | null;
  stock: number; min_level: number; cost: number; price: number | null; mrp: number | null;
  value_cost: number; value_mrp: number; sold_units: number; returned_units: number; revenue: number;
  avg_daily: number; days_cover: number | null; last_sold_at: string | null; last_purchased_at: string | null;
  days_since_sale: number | null; stock_status: "ok" | "low" | "out"; movement: Movement;
}
export interface InventoryCategory { key: string; label: string; skus: number; stock_units: number; value_cost: number; value_mrp: number; dead_value: number; sold_units: number }
export interface InventoryReport {
  days: number; total: number;
  totals: {
    skus: number; stock_units: number; value_cost: number; value_mrp: number; out_of_stock: number; low_stock: number;
    dead: number; dead_value: number; fast: number; slow: number; negative_stock: number; sold_units: number;
  };
  categories: InventoryCategory[];
  rows: InventoryRow[];
}

export interface ExpiryRow {
  batch_id: string; product_id: string; name: string; sku: string | null; category: string | null; batch_no: string | null;
  expiry_date: string; days_left: number; bucket: string; batch_qty: number; stock: number; qty_left: number;
  cost: number; value_cost: number; value_mrp: number;
}
export interface ExpiryReport {
  as_of: string; days: number; total: number;
  totals: { batches: number; qty_left: number; value_cost: number; value_mrp: number; empty_batches: number };
  buckets: { key: string; label: string; batches: number; qty_left: number; value_cost: number }[];
  rows: ExpiryRow[];
}

export interface MovementTypeRow { key: string; entries: number; qty_in: number; qty_out: number; value_in: number; value_out: number }
export interface MovementRow {
  id: string; created_at: string; product_id: string; name: string; sku: string | null; category: string | null;
  movement_type: string; note: string | null; quantity_change: number; stock_before: number; stock_after: number;
  unit_cost: number | null; value: number; source_type: string | null; source_id: string | null; by_name: string | null;
}
export interface MovementReport {
  total: number; by_type: MovementTypeRow[];
  adjust_reasons: { key: string; entries: number; qty_in: number; qty_out: number; net_value: number }[];
  rows: MovementRow[];
}

export type PurchaseBy = "supplier" | "product" | "category" | "bill";
export interface PurchaseTotals {
  bills: number; taxable: number; tax: number; total: number; suppliers: number; returns_total: number; paid: number;
  lines_taxable?: number; lines_tax?: number; lines_total?: number; lines_qty?: number;
}
export interface PurchaseRow {
  key: string; label: string; taxable: number; tax: number; total: number;
  // supplier
  bills?: number; returns_total?: number; net_total?: number; paid?: number; balance_now?: number | null; last_bill_date?: string;
  // bill
  bill_date?: string; bill_number?: string | null; supplier_id?: string; lines?: number;
  // product / category
  sku?: string | null; category?: string | null; products?: number; qty?: number; free_qty?: number; damaged_qty?: number;
  avg_cost?: number | null; cost_per_piece?: number | null; min_cost?: number; max_cost?: number;
  first_cost?: number; last_cost?: number; cost_now?: number; cost_change_pct?: number | null;
}
export interface PurchaseReport { by: PurchaseBy; total: number; totals: PurchaseTotals; rows: PurchaseRow[] }

interface Page { search?: string | null; limit?: number; offset?: number }

export const reportInventory = (
  from: string, to: string, locationId: string | null,
  opts: Page & { category?: string | null; status?: StockFilter; sort?: string; dir?: "asc" | "desc" } = {},
) =>
  call<InventoryReport>("report_inventory", {
    p_from: from, p_to: to, p_location_id: locationId, p_category: opts.category ?? null, p_search: opts.search ?? null,
    p_status: opts.status ?? "all", p_sort: opts.sort ?? "value", p_dir: opts.dir ?? "desc",
    p_limit: opts.limit ?? 25, p_offset: opts.offset ?? 0,
  });

export const reportExpiry = (locationId: string | null, days: number, opts: Page = {}) =>
  call<ExpiryReport>("report_expiry", {
    p_location_id: locationId, p_days: days, p_search: opts.search ?? null, p_limit: opts.limit ?? 25, p_offset: opts.offset ?? 0,
  });

export const reportStockMovement = (from: string, to: string, locationId: string | null, opts: Page & { type?: string | null } = {}) =>
  call<MovementReport>("report_stock_movement", {
    p_from: from, p_to: to, p_location_id: locationId, p_type: opts.type ?? null, p_search: opts.search ?? null,
    p_limit: opts.limit ?? 25, p_offset: opts.offset ?? 0,
  });

export const reportPurchases = (from: string, to: string, locationId: string | null, by: PurchaseBy, opts: Page = {}) =>
  call<PurchaseReport>("report_purchases", {
    p_from: from, p_to: to, p_location_id: locationId, p_by: by, p_search: opts.search ?? null,
    p_limit: opts.limit ?? 25, p_offset: opts.offset ?? 0,
  });

// ---------------------------------------------------------------- Phase 5: khata, payments and registers
// (supabase/migrations/20261127450000_reports_khata_payments.sql)
export type AgeingFilter = "all" | "d0_7" | "d8_15" | "d16_30" | "d31_60" | "d60_plus" | "overdue" | "over_limit" | "advance";
export interface AgeingRow {
  customer_id: string; name: string; phone: string | null; customer_group: string | null; balance: number;
  d0_7: number; d8_15: number; d16_30: number; d31_60: number; d60_plus: number; overdue: number;
  oldest_age: number | null; oldest_due_at: string | null; bucket: string | null;
  credit_limit: number | null; credit_days: number | null; last_payment_at: string | null; days_since_payment: number | null;
}
export interface AgeingReport {
  as_of: string; total: number;
  totals: {
    customers_owing: number; outstanding: number; advance: number; customers_advance: number;
    d0_7: number; d8_15: number; d16_30: number; d31_60: number; d60_plus: number;
    overdue: number; customers_overdue: number; over_limit: number;
  };
  rows: AgeingRow[];
}

export interface StatementRow { at: string; kind: "opening" | "udhaar" | "payment" | "refund"; ref: string | null; ref_id: string | null; method: string | null; amount: number; note: string | null; running: number }
export interface StatementReport {
  customer: { customer_id: string; name: string; phone: string | null; credit_limit: number | null; credit_days: number | null };
  from: string; to: string; opening: number; udhaar: number; received: number; closing: number; balance_now: number; total: number;
  rows: StatementRow[];
}

export type MoneyKind = "bill" | "khata" | "refund" | "supplier" | "expense";
export interface MoneyRow { at: string; kind: MoneyKind; method: string; amount: number; ref: string | null; ref_id: string; party: string | null; by_name: string | null }
export interface PaymentRegister {
  total: number; udhaar_given: number; khata_refunds: number;
  by_method: { key: string; money_in: number; money_out: number; net: number; entries: number }[];
  by_kind: { key: MoneyKind; amount: number; entries: number }[];
  by_day: { bucket: string; money_in: number; money_out: number; cash_net: number }[];
  rows: MoneyRow[];
}

export interface RegisterRow {
  id: string; user_id: string; cashier: string | null; opened_at: string; closed_at: string | null; opening_cash: number;
  expected_cash: number | null; counted_cash: number | null; difference: number | null;
  upi_expected: number | null; upi_counted: number | null; upi_diff: number | null;
  card_expected: number | null; card_counted: number | null; card_diff: number | null;
  note: string | null; bills: number | null; total_sales: number | null; cash_sales: number | null;
}
export interface RegisterReport {
  total: number;
  totals: {
    sessions: number; closed: number; open: number; short: number; over: number; net: number;
    short_count: number; over_count: number; exact_count: number; upi_diff: number; card_diff: number;
    expected_cash: number; counted_cash: number;
  };
  by_cashier: { key: string; label: string; sessions: number; short: number; over: number; net: number; short_count: number }[];
  rows: RegisterRow[];
}

export const reportKhataAgeing = (locationId: string | null, opts: Page & { bucket?: AgeingFilter; sort?: string; dir?: "asc" | "desc" } = {}) =>
  call<AgeingReport>("report_khata_ageing", {
    p_location_id: locationId, p_search: opts.search ?? null, p_bucket: opts.bucket ?? "all",
    p_sort: opts.sort ?? "due", p_dir: opts.dir ?? "desc", p_limit: opts.limit ?? 25, p_offset: opts.offset ?? 0,
  });

export const reportKhataStatement = (customerId: string, from: string, to: string) =>
  call<StatementReport>("report_khata_statement", { p_customer_id: customerId, p_from: from, p_to: to, p_limit: 500 });

export const reportPaymentRegister = (from: string, to: string, locationId: string | null, opts: Page & { method?: string | null; kind?: string | null } = {}) =>
  call<PaymentRegister>("report_payment_register", {
    p_from: from, p_to: to, p_location_id: locationId, p_method: opts.method ?? null, p_kind: opts.kind ?? null,
    p_search: opts.search ?? null, p_limit: opts.limit ?? 25, p_offset: opts.offset ?? 0,
  });

export const reportRegisters = (from: string, to: string, locationId: string | null, opts: Page = {}) =>
  call<RegisterReport>("report_registers", { p_from: from, p_to: to, p_location_id: locationId, p_limit: opts.limit ?? 25, p_offset: opts.offset ?? 0 });

// ---------------------------------------------------------------- Phase 6: GST and staff
export interface GstSplit { taxable: number; cgst: number; sgst: number; igst: number; tax: number }
export interface GstRateRow extends GstSplit { rate: number }
export interface GstReport {
  from: string; to: string;
  output: GstSplit & {
    sales_taxable: number; sales_tax: number; credit_notes_taxable: number; credit_notes_tax: number;
    b2b_taxable: number; b2b_tax: number; b2c_taxable: number; b2c_tax: number;
  };
  input: GstSplit & { purchases_taxable: number; purchases_tax: number; returns_taxable: number; returns_tax: number; no_gstin_tax: number };
  net: { cgst: number; sgst: number; igst: number; tax: number };
  checks: { no_hsn_lines: number; no_hsn_value: number; zero_rated_value: number; input_without_gstin_tax: number; purchases_without_store_state: number };
  output_by_rate: GstRateRow[];
  input_by_rate: GstRateRow[];
  hsn: (GstRateRow & { hsn: string; description: string | null; qty: number })[];
  by_month: { bucket: string; output_tax: number; input_tax: number; net: number }[];
}

export interface StaffRow {
  user_id: string | null; login: boolean; name: string; job_title: string | null;
  bills: number; billed: number; gross_sales: number; discounts: number; discount_pct: number | null; discounted_bills: number;
  returns_count: number; returns_value: number; net_sales: number; avg_bill: number | null; units_per_bill: number | null;
  khata_count: number; khata_collected: number;
  sessions: number; cash_short: number; short_count: number; cash_net_diff: number; register_hours: number; sales_per_hour: number | null;
  discount_approvals: number;
  present: number | null; half_days: number | null; absent: number | null; leave: number | null; late_minutes: number | null; late_days: number | null;
}
export interface StaffReport {
  from: string; to: string;
  totals: { people: number; bills: number; net_sales: number; discounts: number; returns_value: number; cash_short: number; khata_collected: number };
  rows: StaffRow[];
}

export const reportGst = (from: string, to: string, locationId: string | null) =>
  call<GstReport>("report_gst", { p_from: from, p_to: to, p_location_id: locationId });

export const reportStaff = (from: string, to: string, locationId: string | null) =>
  call<StaffReport>("report_staff", { p_from: from, p_to: to, p_location_id: locationId });
