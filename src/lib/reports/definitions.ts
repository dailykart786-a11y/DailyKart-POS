// How each report figure is worked out, in plain words. Shown in the (i)
// tooltips on the Reports page. Keep in step with report_period() in
// supabase/migrations/20261127420000_reports_core.sql.

export interface KpiDefinition { label: string; how: string; source: string }

export const KPI: Record<string, KpiDefinition> = {
  gross_sales: { label: "Gross sales", how: "Value of everything billed before discounts, without GST.", source: "Bills" },
  discounts: { label: "Discounts", how: "Discounts given on bills, without GST.", source: "Bills" },
  net_sales: { label: "Net sales", how: "Gross sales minus discounts minus returns. GST is not included.", source: "Bills, returns" },
  returns: { label: "Sales returns", how: "Value of goods customers brought back, without GST. Counted on the day of the return.", source: "Returns" },
  gst_collected: { label: "GST collected", how: "GST on bills minus GST given back on returns.", source: "Bills, returns" },
  bills: { label: "Bills", how: "Number of bills made.", source: "Bills" },
  avg_bill: { label: "Average bill", how: "Total billed (with GST) divided by the number of bills.", source: "Bills" },
  billed_total: { label: "Total billed", how: "What customers were charged, with GST, after discounts.", source: "Bills" },
  cogs: { label: "Cost of goods sold", how: "Quantity sold times the purchase cost saved at the moment of each sale, minus the same cost for returned goods.", source: "Stock movements" },
  gross_profit: { label: "Gross profit", how: "Net sales minus cost of goods sold. Purchases are not subtracted here; only the cost of what was sold.", source: "Bills, returns, stock movements" },
  gross_margin: { label: "Gross margin", how: "Gross profit as a percentage of net sales.", source: "Bills, returns, stock movements" },
  expenses: { label: "Expenses", how: "Approved expenses dated in this period. Waiting or rejected ones are left out.", source: "Expenses" },
  stock_written_off: { label: "Stock written off", how: "Cost of damaged, expired, lost or own-use stock, less any stock found.", source: "Stock adjustments" },
  net_profit: { label: "Net profit", how: "Gross profit minus expenses minus stock written off, plus other income from journals.", source: "Bills, returns, stock, expenses, journals" },
  purchases_total: { label: "Purchases", how: "Supplier bills dated in this period, with GST. Purchases add to stock; they are not an expense.", source: "Purchases" },
  credit_sales: { label: "Udhaar given", how: "Part of bills put on the customer's khata. Not counted as money received.", source: "Bills" },
  collections: { label: "Money received", how: "Cash, UPI, card and bank received on bills, plus udhaar payments received. A split bill adds each part to its own method once.", source: "Bills, khata payments" },
  customer_outstanding: { label: "Customer dues", how: "What customers owe right now: opening balance plus udhaar bills, minus payments and khata refunds.", source: "Khata" },
  supplier_outstanding: { label: "Supplier dues", how: "What you owe suppliers right now: opening balance plus purchases, minus payments and returns.", source: "Purchases, supplier payments" },
  inventory_value: { label: "Stock value", how: "Stock in hand times the latest purchase cost of each product.", source: "Products" },
};

export const COST_MISSING_NOTE =
  "Some bill lines have no saved purchase cost (usually bills made before the stock ledger was added). Their sales are left out of profit rather than guessed.";
