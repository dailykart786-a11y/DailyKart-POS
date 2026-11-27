import { supabase } from "@/integrations/supabase/client";

// Shop details printed on bills. Falls back to the old fixed header when
// the store has not filled them in (or the GST columns don't exist yet).
export interface StoreDetails {
  business_name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  state_code: string | null;
  bill_footer: string | null;
}

export const DEFAULT_STORE: StoreDetails = {
  business_name: "DAILYKART POS",
  address: null,
  phone: "+91-9966160298, +91-9381309140",
  email: "dailykart786@gmail.com",
  gstin: null,
  state_code: null,
  bill_footer: null,
};

export const INDIAN_STATES: { code: string; name: string }[] = [
  { code: "01", name: "Jammu and Kashmir" }, { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" }, { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" }, { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" }, { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" }, { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" }, { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" }, { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" }, { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" }, { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" }, { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" }, { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" }, { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" }, { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" }, { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" }, { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" }, { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" }, { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" }, { code: "38", name: "Ladakh" },
];

export const stateName = (code?: string | null) =>
  INDIAN_STATES.find((s) => s.code === code)?.name || null;

// GSTIN format: 2-digit state, 10-char PAN, entity, Z, checksum
export const isValidGstin = (gstin: string) =>
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin.trim().toUpperCase());

/** The store id for the signed-in user (their assigned store, else Default Store). */
export async function getMyLocationId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("user_location_assignments")
    .select("location_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (data?.location_id) return data.location_id;
  const { data: def } = await supabase
    .from("locations")
    .select("id")
    .eq("name", "Default Store")
    .maybeSingle();
  return def?.id ?? null;
}

export async function fetchStoreDetails(locationId: string | null | undefined): Promise<StoreDetails> {
  if (!locationId) return DEFAULT_STORE;
  try {
    const { data, error } = await supabase.from("locations").select("*").eq("id", locationId).maybeSingle();
    if (error || !data) return DEFAULT_STORE;
    const row = data as Record<string, any>;
    const hasOwnDetails = !!(row.business_name && String(row.business_name).trim());
    return {
      business_name: hasOwnDetails ? row.business_name : DEFAULT_STORE.business_name,
      address: row.address ?? null,
      phone: row.phone || (hasOwnDetails ? null : DEFAULT_STORE.phone),
      email: row.email || (hasOwnDetails ? null : DEFAULT_STORE.email),
      gstin: row.gstin || null,
      state_code: row.state_code || null,
      bill_footer: row.bill_footer || null,
    };
  } catch {
    return DEFAULT_STORE;
  }
}

export interface InvoiceLine {
  name: string;
  hsn: string | null;
  quantity: number;
  rate: number;          // price per unit before discount and GST
  discountPercent: number;
  taxable: number;       // after discount, before GST
  gstRate: number;
  gstAmount: number;
  total: number;         // taxable + GST
}

export interface TaxRow {
  rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface Invoice {
  store: StoreDetails;
  invoiceNumber: string;
  createdAt: string;
  paymentMethod: string;
  customerName: string | null;
  customerGstin: string | null;
  interstate: boolean;
  lines: InvoiceLine[];
  taxable: number;
  discount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  total: number;
  taxRows: TaxRow[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function makeLine(args: {
  name: string; hsn?: string | null; quantity: number; rate: number; discountPercent?: number; gstRate?: number | null;
}): InvoiceLine {
  const disc = Math.max(0, Math.min(100, args.discountPercent || 0));
  const base = args.rate * args.quantity;
  const taxable = r2(base - r2((base * disc) / 100));
  const gstRate = Number(args.gstRate || 0);
  const gstAmount = r2((taxable * gstRate) / 100);
  return {
    name: args.name,
    hsn: args.hsn || null,
    quantity: args.quantity,
    rate: args.rate,
    discountPercent: disc,
    taxable,
    gstRate,
    gstAmount,
    total: r2(taxable + gstAmount),
  };
}

export function buildInvoice(args: {
  store: StoreDetails;
  invoiceNumber: string;
  createdAt: string;
  paymentMethod?: string | null;
  customerName?: string | null;
  customerGstin?: string | null;
  interstate?: boolean;
  lines: InvoiceLine[];
  total?: number; // saved total from the database, if known
}): Invoice {
  const interstate = !!args.interstate;
  const byRate = new Map<number, TaxRow>();
  let discount = 0;
  for (const l of args.lines) {
    discount += l.rate * l.quantity - l.taxable;
    const row = byRate.get(l.gstRate) || { rate: l.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    row.taxable = r2(row.taxable + l.taxable);
    if (interstate) {
      row.igst = r2(row.igst + l.gstAmount);
    } else {
      // Split evenly; any odd paisa goes to CGST so the two add up exactly
      const half = Math.floor((l.gstAmount * 100) / 2) / 100;
      row.sgst = r2(row.sgst + half);
      row.cgst = r2(row.cgst + (l.gstAmount - half));
    }
    byRate.set(l.gstRate, row);
  }
  const taxRows = Array.from(byRate.values()).sort((a, b) => a.rate - b.rate);
  const sum = (k: keyof TaxRow) => r2(taxRows.reduce((s, r) => s + (r[k] as number), 0));
  const taxable = sum("taxable");
  const cgst = sum("cgst");
  const sgst = sum("sgst");
  const igst = sum("igst");
  const totalTax = r2(cgst + sgst + igst);
  return {
    store: args.store,
    invoiceNumber: args.invoiceNumber,
    createdAt: args.createdAt,
    paymentMethod: (args.paymentMethod || "cash").toUpperCase(),
    customerName: args.customerName || null,
    customerGstin: args.customerGstin || null,
    interstate,
    lines: args.lines,
    taxable,
    discount: r2(discount),
    cgst,
    sgst,
    igst,
    totalTax,
    total: args.total != null ? r2(Number(args.total)) : r2(taxable + totalTax),
    taxRows,
  };
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (n: number) => n.toFixed(2);

/** Full HTML page for an 80mm thermal printer. */
export function receiptHtml(inv: Invoice): string {
  const s = inv.store;
  const st = stateName(s.state_code);
  const lines = inv.lines
    .map(
      (l) => `
      <div class="bold">${esc(l.name)}</div>
      <div class="row small"><span>${esc(l.quantity)} x ${money(l.rate)}${l.discountPercent ? ` (-${l.discountPercent}%)` : ""}${l.hsn ? ` | HSN ${esc(l.hsn)}` : ""} | GST ${l.gstRate}%</span><span>${money(l.total)}</span></div>`
    )
    .join("");
  const taxHead = inv.interstate
    ? `<div class="row small bold"><span>GST%</span><span>Taxable</span><span>IGST</span></div>`
    : `<div class="row small bold"><span>GST%</span><span>Taxable</span><span>CGST</span><span>SGST</span></div>`;
  const taxRows = inv.taxRows
    .map((r) =>
      inv.interstate
        ? `<div class="row small"><span>${r.rate}%</span><span>${money(r.taxable)}</span><span>${money(r.igst)}</span></div>`
        : `<div class="row small"><span>${r.rate}%</span><span>${money(r.taxable)}</span><span>${money(r.cgst)}</span><span>${money(r.sgst)}</span></div>`
    )
    .join("");
  const taxTotals = inv.interstate
    ? `<div class="row"><span>IGST</span><span>${money(inv.igst)}</span></div>`
    : `<div class="row"><span>CGST</span><span>${money(inv.cgst)}</span></div>
       <div class="row"><span>SGST</span><span>${money(inv.sgst)}</span></div>`;
  const d = new Date(inv.createdAt || Date.now());
  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(inv.invoiceNumber)}</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  body { margin: 0; font-family: monospace; font-size: 12px; width: 74mm; color: #000; }
  .center { text-align: center; } .bold { font-weight: bold; } .small { font-size: 10px; }
  .big { font-size: 15px; }
  .row { display: flex; justify-content: space-between; gap: 4px; }
  .dashed { border-top: 1px dashed #000; margin: 6px 0; }
</style></head><body>
  <div class="center">
    <div class="bold big">${esc(s.business_name)}</div>
    ${s.address ? `<div class="small">${esc(s.address)}</div>` : ""}
    ${s.phone ? `<div class="small">Ph: ${esc(s.phone)}</div>` : ""}
    ${s.email ? `<div class="small">${esc(s.email)}</div>` : ""}
    ${s.gstin ? `<div class="small bold">GSTIN: ${esc(s.gstin)}</div>` : ""}
    ${st ? `<div class="small">State: ${esc(st)} (${esc(s.state_code)})</div>` : ""}
  </div>
  <div class="dashed"></div>
  <div class="center bold">TAX INVOICE</div>
  <div class="row small"><span>Bill: ${esc(inv.invoiceNumber)}</span><span>${d.toLocaleDateString("en-IN")} ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span></div>
  ${inv.customerName ? `<div class="small">Customer: ${esc(inv.customerName)}</div>` : ""}
  ${inv.customerGstin ? `<div class="small">Customer GSTIN: ${esc(inv.customerGstin)}</div>` : ""}
  <div class="dashed"></div>
  ${lines}
  <div class="dashed"></div>
  <div class="row"><span>Taxable value</span><span>${money(inv.taxable)}</span></div>
  ${inv.discount > 0 ? `<div class="row small"><span>(Discount given</span><span>${money(inv.discount)})</span></div>` : ""}
  ${taxTotals}
  <div class="dashed"></div>
  <div class="row bold big"><span>TOTAL</span><span>Rs ${money(inv.total)}</span></div>
  <div class="center small">Paid by ${esc(inv.paymentMethod)}</div>
  <div class="dashed"></div>
  <div class="center small bold">GST summary</div>
  ${taxHead}${taxRows}
  <div class="dashed"></div>
  <div class="center small">
    ${s.bill_footer ? esc(s.bill_footer) : "Thank you for shopping! Visit again."}
  </div>
</body></html>`;
}

/** Opens the print dialog for a receipt. */
export function printReceipt(inv: Invoice) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(receiptHtml(inv));
  w.document.close();
  w.focus();
  // Give the browser a moment to lay out before printing
  setTimeout(() => {
    w.print();
    w.close();
  }, 250);
  return true;
}

/** Plain-text bill for WhatsApp. */
export function receiptText(inv: Invoice): string {
  const s = inv.store;
  const items = inv.lines
    .map((l, i) => `${i + 1}. ${l.name}\n   ${l.quantity} x ₹${money(l.rate)}${l.discountPercent ? ` (-${l.discountPercent}%)` : ""} + GST ${l.gstRate}% = ₹${money(l.total)}`)
    .join("\n");
  const tax = inv.interstate
    ? `IGST: ₹${money(inv.igst)}`
    : `CGST: ₹${money(inv.cgst)}\nSGST: ₹${money(inv.sgst)}`;
  return [
    `🏪 *${s.business_name}*`,
    s.gstin ? `GSTIN: ${s.gstin}` : null,
    s.phone ? `📱 ${s.phone}` : null,
    "",
    `🧾 *Tax Invoice ${inv.invoiceNumber}*`,
    `📅 ${new Date(inv.createdAt || Date.now()).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
    inv.customerName ? `👤 ${inv.customerName}` : null,
    "",
    items,
    "",
    `Taxable value: ₹${money(inv.taxable)}`,
    tax,
    `*TOTAL: ₹${money(inv.total)}*`,
    `Paid by ${inv.paymentMethod}`,
    "",
    s.bill_footer || "🙏 Thank you for shopping with us!",
  ]
    .filter((x) => x !== null)
    .join("\n");
}
