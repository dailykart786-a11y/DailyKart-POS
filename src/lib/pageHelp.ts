// Short "what is this page for" help shown behind the (i) button at the
// top of every page. Keyed by the page's address in lib/nav.ts.
export interface PageHelp {
  /** One or two plain sentences on what the module is for. */
  about: string;
  /** A few things people typically do here. */
  uses: string[];
}

export const PAGE_HELP: Record<string, PageHelp> = {
  "/": {
    about: "Your shop at a glance: today's sales, bills, cash and alerts in one place.",
    uses: ["See how today is going compared with other days", "Spot low stock, pending khata and alerts", "Jump to the page you need next"],
  },
  "/sales": {
    about: "The billing counter. Scan or search items, make the bill and take payment by cash, UPI, card or khata.",
    uses: ["Make a GST bill for a customer", "Split one bill across cash and UPI", "Hold a bill and come back to it", "Print or WhatsApp the invoice"],
  },
  "/orders": {
    about: "Orders that come by phone, WhatsApp or the online catalogue, from new to packed to delivered.",
    uses: ["Note down a phone or WhatsApp order", "Track which orders are packed or out for delivery", "Turn a delivered order into a bill"],
  },
  "/returns": {
    about: "Take back items a customer returns and give a refund or a credit note.",
    uses: ["Find the original bill and pick returned items", "Refund in cash or to the customer's khata", "Put returned stock back on the shelf"],
  },
  "/register": {
    about: "Count the cash drawer when your shift starts and ends, and check UPI, card and other payments against what the bills say.",
    uses: ["Count opening cash note by note and coin by coin", "At closing, match cash, UPI and card with the day's sales", "See any short or extra amount and past closings"],
  },
  "/products": {
    about: "Your item master: names, prices, MRP, barcodes, GST rate and HSN code for everything you sell.",
    uses: ["Add or edit an item and its price", "Print barcode labels", "Import many items at once from Excel"],
  },
  "/stock": {
    about: "How much of each item you have, what to reorder, and items that are close to expiry.",
    uses: ["Check stock levels and the reorder list", "Correct stock after a count, damage or loss", "See batches that expire soon"],
  },
  "/purchases": {
    about: "Buying from suppliers: purchase orders, goods received and what you owe each supplier.",
    uses: ["Record a supplier bill so stock goes up", "Raise a purchase order", "Pay suppliers and see their balance"],
  },
  "/customers": {
    about: "Your customer list with phone numbers, GSTIN and everything they have bought.",
    uses: ["Add a regular customer", "Look up a customer's past bills", "Keep GST details for B2B bills"],
  },
  "/khata": {
    about: "Udhaar book. Who owes the shop money, how much, and the payments they make.",
    uses: ["See each customer's pending balance", "Record a payment in cash or UPI", "Send a payment reminder"],
  },
  "/offers": {
    about: "Discounts, coupons and loyalty points that apply automatically at billing.",
    uses: ["Run an offer on an item or category", "Turn loyalty points on or off for a store", "See points customers have earned and used"],
  },
  "/expenses": {
    about: "Day-to-day shop spending like rent, electricity, tea and transport.",
    uses: ["Record an expense, paid from the till or the bank", "Approve expenses staff have added", "See spending by category"],
  },
  "/accounts": {
    about: "Simple books for the business: profit and loss, balance sheet and cash book.",
    uses: ["See profit for a month", "Check cash and bank balances", "Share numbers with your accountant"],
  },
  "/reports": {
    about: "Sales and profit reports by day, item, category, staff and payment method.",
    uses: ["Find your best-selling items", "Compare sales between periods", "Download a report as CSV"],
  },
  "/gst": {
    about: "GST summaries ready for filing: GSTR-1, GSTR-3B and HSN-wise totals.",
    uses: ["Get monthly GSTR-3B figures", "Download B2B and B2C details for GSTR-1", "Check tax by rate and HSN code"],
  },
  "/staff": {
    about: "Your shop staff: attendance, advances and monthly salary.",
    uses: ["Mark daily attendance", "Record an advance given to staff", "Work out salary at month end"],
  },
  "/activity": {
    about: "A log of who changed what and when, for keeping the shop's records honest.",
    uses: ["See who edited a price or deleted a bill", "Check changes made on a given day", "Review what a staff member did"],
  },
  "/users": {
    about: "Sign-ins for the app. Create staff logins, set their role and which store they work in.",
    uses: ["Add a cashier or manager login", "Change someone's role or store", "Remove access for staff who left"],
  },
  "/settings": {
    about: "Shop details printed on bills and how you take UPI payments.",
    uses: ["Set shop name, address and GSTIN", "Add your UPI ID for the QR code", "Change bill and catalogue settings"],
  },
};
