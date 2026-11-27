import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle, Banknote, BookOpen, Boxes, CalendarClock, CreditCard, IndianRupee, Landmark, PackageX,
  PiggyBank, Receipt, ShoppingBag, Smartphone, TrendingUp, Truck, Undo2, Users, Wallet,
} from "lucide-react";
import type { DashboardData, DayRow } from "@/lib/dashboard";

export type KpiFormat = "money" | "count";

export interface KpiDef {
  id: string;
  label: string;
  help: string;
  icon: LucideIcon;
  format: KpiFormat;
  /** Where clicking the card goes. */
  link: string;
  /** Permission needed to follow the link (card still shows its number). */
  linkPermission?: string;
  value: (d: DashboardData) => number | undefined;
  /** Same figure for the previous period; leave out for "right now" figures. */
  previous?: (d: DashboardData) => number | undefined;
  /** Small trend line from the daily rows. */
  spark?: (r: DayRow) => number | undefined;
  /** For costs and returns a fall is good news. */
  lowerIsBetter?: boolean;
  /** Counts that mean trouble when above zero (shown in amber). */
  warnIfPositive?: boolean;
  hiddenByDefault?: boolean;
}

export const KPIS: KpiDef[] = [
  { id: "gross_sales", label: "Gross sales", icon: IndianRupee, format: "money", link: "/sales", linkPermission: "sales",
    help: "Total of all bills in the period, GST included, before returns.",
    value: (d) => d.current.gross_sales, previous: (d) => d.previous.gross_sales, spark: (r) => r.sales },
  { id: "net_sales", label: "Net sales", icon: Wallet, format: "money", link: "/returns", linkPermission: "returns",
    help: "Gross sales minus money refunded on returns in the period.",
    value: (d) => d.current.net_sales, previous: (d) => d.previous.net_sales, spark: (r) => r.sales - r.returns },
  { id: "bills", label: "Bills", icon: Receipt, format: "count", link: "/sales", linkPermission: "sales",
    help: "Number of bills made in the period (cancelled bills not counted).",
    value: (d) => d.current.bills, previous: (d) => d.previous.bills, spark: (r) => r.bills },
  { id: "avg_bill", label: "Average bill", icon: ShoppingBag, format: "money", link: "/reports", linkPermission: "reports",
    help: "Gross sales divided by the number of bills.",
    value: (d) => d.current.avg_bill, previous: (d) => d.previous.avg_bill, spark: (r) => (r.bills ? r.sales / r.bills : 0) },
  { id: "gross_profit", label: "Gross profit", icon: TrendingUp, format: "money", link: "/reports", linkPermission: "reports",
    help: "Sales before GST, less returns, less the cost price of the items sold. Items without a cost price count as zero cost.",
    value: (d) => d.current.gross_profit, previous: (d) => d.previous.gross_profit },
  { id: "net_profit", label: "Estimated net profit", icon: PiggyBank, format: "money", link: "/accounts", linkPermission: "accounts",
    help: "Gross profit minus approved expenses in the period. An estimate: salaries and other costs not entered as expenses are not included.",
    value: (d) => d.current.net_profit, previous: (d) => d.previous.net_profit },
  { id: "expenses", label: "Expenses", icon: Banknote, format: "money", link: "/expenses", linkPermission: "expenses", lowerIsBetter: true,
    help: "Approved expenses dated in the period. Expenses waiting for approval are not counted.",
    value: (d) => d.current.expenses, previous: (d) => d.previous.expenses, spark: (r) => r.expenses },
  { id: "cash", label: "Cash collected", icon: Banknote, format: "money", link: "/register", linkPermission: "register",
    help: "Cash taken on bills in the period, including the cash part of split payments.",
    value: (d) => d.current.cash, previous: (d) => d.previous.cash },
  { id: "upi", label: "UPI collected", icon: Smartphone, format: "money", link: "/register", linkPermission: "register",
    help: "UPI taken on bills in the period, including the UPI part of split payments.",
    value: (d) => d.current.upi, previous: (d) => d.previous.upi },
  { id: "card", label: "Card collected", icon: CreditCard, format: "money", link: "/register", linkPermission: "register",
    help: "Card payments on bills in the period, including the card part of split payments.",
    value: (d) => d.current.card, previous: (d) => d.previous.card },
  { id: "bank", label: "Bank transfer", icon: Landmark, format: "money", link: "/register", linkPermission: "register", hiddenByDefault: true,
    help: "Bank transfers on bills in the period.",
    value: (d) => d.current.bank, previous: (d) => d.previous.bank },
  { id: "credit", label: "Credit (udhaar) sales", icon: BookOpen, format: "money", link: "/khata", linkPermission: "khata",
    help: "Part of the bills in the period given on credit, to be collected later.",
    value: (d) => d.current.credit, previous: (d) => d.previous.credit },
  { id: "returns", label: "Returns", icon: Undo2, format: "money", link: "/returns", linkPermission: "returns", lowerIsBetter: true, hiddenByDefault: true,
    help: "Money refunded on returns in the period.",
    value: (d) => d.current.returns, previous: (d) => d.previous.returns, spark: (r) => r.returns },
  { id: "customer_due", label: "Customer udhaar", icon: BookOpen, format: "money", link: "/khata", linkPermission: "khata",
    help: "Total customers owe you right now, across all dates.",
    value: (d) => d.now.customer_due },
  { id: "supplier_due", label: "Owed to suppliers", icon: Truck, format: "money", link: "/purchases", linkPermission: "purchases",
    help: "Total you owe suppliers right now, across all dates.",
    value: (d) => d.now.supplier_due },
  { id: "stock_value", label: "Stock value", icon: Boxes, format: "money", link: "/stock", linkPermission: "stock",
    help: "Stock on hand right now, at cost price. Active products only.",
    value: (d) => d.now.stock_value },
  { id: "low_stock", label: "Low stock", icon: AlertTriangle, format: "count", link: "/stock", linkPermission: "stock", warnIfPositive: true,
    help: "Products at or below their minimum stock level (but not out). Products without a minimum are not counted.",
    value: (d) => d.now.low_stock },
  { id: "out_of_stock", label: "Out of stock", icon: PackageX, format: "count", link: "/stock", linkPermission: "stock", warnIfPositive: true,
    help: "Active products with zero or less in stock right now.",
    value: (d) => d.now.out_of_stock },
  { id: "expiring", label: "Expiring in 30 days", icon: CalendarClock, format: "count", link: "/stock", linkPermission: "stock", warnIfPositive: true,
    help: "Stock batches with an expiry date in the next 30 days. Only batches entered with an expiry date are counted.",
    value: (d) => d.now.expiring },
  { id: "customers", label: "Customers", icon: Users, format: "count", link: "/customers", linkPermission: "customers",
    help: "Customers saved for this store, all time. The small line shows how many were added in the period.",
    value: (d) => d.customers.total },
];

export const DEFAULT_ORDER = KPIS.map((k) => k.id);
export const DEFAULT_HIDDEN = KPIS.filter((k) => k.hiddenByDefault).map((k) => k.id);
