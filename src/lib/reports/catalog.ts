// Every report on the Reports page, grouped by category, with a short
// plain-words description. "phase" marks reports still being built: they
// are listed so the owner can see what's coming, but not shown as working.
import type { LucideIcon } from "lucide-react";
import { BadgeIndianRupee, Boxes, Package, ClipboardList, Landmark, Receipt, ShoppingBag, Truck, UserCog, Users, Wallet, BookOpen } from "lucide-react";

export interface ReportDef {
  id: string;
  title: string;
  about: string;
  /** Set when the report isn't built yet: the phase that adds it. */
  phase?: number;
}

export interface ReportCategory { id: string; title: string; icon: LucideIcon; reports: ReportDef[] }

export const CATEGORIES: ReportCategory[] = [
  {
    id: "sales", title: "Sales", icon: ShoppingBag,
    reports: [
      { id: "sales.summary", title: "Sales summary", about: "Gross and net sales, discounts, returns and GST by day, week, month or year." },
      { id: "sales.hourly", title: "Busy hours", about: "Which hours of the day bring the most bills and sales." },
      { id: "sales.weekday", title: "Day of the week", about: "Sales on each day of the week, to plan staff and stock." },
      { id: "sales.payments", title: "Payment methods", about: "How customers paid: cash, UPI, card, bank or udhaar. Split bills are counted once per method." },
      { id: "sales.category", title: "Category-wise sales", about: "Sales, returns and profit for each product category." },
      { id: "sales.cashier", title: "Cashier-wise sales", about: "Bills, sales, discounts and returns handled by each staff member." },
      { id: "sales.returns", title: "Returns and discounts", about: "How much was given away in discounts and taken back in returns." },
      { id: "sales.credit", title: "Udhaar (credit) sales", about: "Bills put on khata versus paid now, and udhaar collected." },
      { id: "sales.invoices", title: "Invoice-wise sales", about: "Every bill with its customer, cashier and payment.", phase: 8 },
    ],
  },
  {
    id: "profit", title: "Profit & loss", icon: BadgeIndianRupee,
    reports: [
      { id: "pl.statement", title: "Profit & loss statement", about: "Net sales, cost of what was sold, expenses and profit for the dates you pick." },
      { id: "pl.trend", title: "Profit by period", about: "Profit day by day or month by month, to spot good and bad stretches." },
      { id: "pl.category", title: "Category-wise profit", about: "Which categories earn the most profit and the best margin." },
      { id: "pl.product", title: "Product-wise profit", about: "Profit and margin for every product sold." },
    ],
  },
  {
    id: "products", title: "Products", icon: Package,
    reports: [
      { id: "product.performance", title: "Product performance", about: "Units, sales, returns, cost and profit for each product." },
      { id: "product.movers", title: "Fast, slow and non-moving", about: "Products that sell fast, slowly or not at all, with days of stock left." },
    ],
  },
  {
    id: "inventory", title: "Inventory", icon: Boxes,
    reports: [
      { id: "stock.valuation", title: "Stock value and status", about: "Stock in hand, its value at cost and MRP, low and out-of-stock items." },
      { id: "stock.expiry", title: "Expiry", about: "Expired and near-expiry batches and their value, by days left." },
      { id: "stock.movement", title: "Stock movement", about: "Every stock change: sales, purchases, returns and adjustments, with reasons." },
    ],
  },
  {
    id: "purchases", title: "Purchases", icon: Truck,
    reports: [
      { id: "purchase.summary", title: "Purchase summary", about: "Supplier bills, GST paid, returns and payments, by supplier, bill or category." },
      { id: "purchase.product", title: "Purchase by product", about: "Quantity bought, free pieces and how each product's purchase cost changed." },
    ],
  },
  {
    id: "customers", title: "Customers", icon: Users,
    reports: [
      { id: "customer.analysis", title: "Customer analysis", about: "Who bought, how often, how much, and what they owe." },
    ],
  },
  {
    id: "khata", title: "Khata (udhaar)", icon: BookOpen,
    reports: [
      { id: "khata.ageing", title: "Dues and ageing", about: "Who owes how much, and for how long.", phase: 5 },
    ],
  },
  {
    id: "expenses", title: "Expenses", icon: Wallet,
    reports: [
      { id: "exp.summary", title: "Expense breakdown", about: "Approved expenses by category and by how they were paid." },
      { id: "exp.trend", title: "Expenses vs sales", about: "Expenses month by month next to net sales, and as a share of sales." },
    ],
  },
  {
    id: "payments", title: "Payments & cash", icon: Landmark,
    reports: [
      { id: "pay.register", title: "Day closing and cash variance", about: "Expected versus counted cash for each register session.", phase: 5 },
    ],
  },
  {
    id: "gst", title: "GST", icon: Receipt,
    reports: [
      { id: "gst.summary", title: "GST summary", about: "Output and input GST, HSN-wise. The GST reports page already has GSTR-1 and 3B.", phase: 6 },
    ],
  },
  {
    id: "staff", title: "Staff", icon: UserCog,
    reports: [
      { id: "staff.performance", title: "Staff performance", about: "Bills, sales, discounts, returns and cash variance by staff member.", phase: 6 },
    ],
  },
  {
    id: "saved", title: "Saved & history", icon: ClipboardList,
    reports: [
      { id: "saved.list", title: "Saved reports", about: "Reports you saved, and recently generated ones.", phase: 9 },
    ],
  },
];

export const ALL_REPORTS: (ReportDef & { category: ReportCategory })[] =
  CATEGORIES.flatMap((c) => c.reports.map((r) => ({ ...r, category: c })));

export const findReport = (id: string | null | undefined) => ALL_REPORTS.find((r) => r.id === id);

export const DEFAULT_REPORT = "sales.summary";
