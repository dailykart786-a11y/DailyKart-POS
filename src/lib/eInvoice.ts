import { isValidGstin, stateName, type StoreDetails } from "./invoice";

// GST e-invoice (NIC schema 1.1) for bills to GST-registered customers.
// The JSON is uploaded on the government e-invoice portal (bulk upload);
// the IRN it gives back is saved on the bill and printed with its QR code.

export interface EInvLine {
  name: string;
  hsn: string | null;
  quantity: number;
  unitPrice: number;     // before discount and GST
  total: number;         // after discount, with GST (sale_items.total_price)
  gst: number;           // GST amount
  gstRate: number;
  soldBy: string | null; // piece / weight / volume
}

export interface EInvBill {
  saleId: string;
  invoice: string;
  date: string;
  interstate: boolean;
  total: number;
  buyer: { name: string; gstin: string; stateCode: string | null; address: string | null; phone: string | null; email: string | null };
  lines: EInvLine[];
}

export interface EInvRecord {
  sale_id: string;
  irn: string;
  ack_no: string | null;
  ack_date: string | null;
  signed_qr: string | null;
  status: string;
  cancel_reason?: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function pinFrom(address: string | null | undefined): number | null {
  const m = (address || "").match(/(?:^|\D)([1-9]\d{5})(?!\d)/);
  return m ? Number(m[1]) : null;
}

/** Town or city: the words just before the PIN code, else the last part of the address. */
export function placeFrom(address: string | null | undefined, stateCode?: string | null): string {
  const a = (address || "").replace(/\s+/g, " ").trim();
  const beforePin = a.replace(/[-\s,]*[1-9]\d{5}\b.*$/, "");
  const parts = beforePin.split(",").map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || "";
  const place = last.length >= 3 ? last : stateName(stateCode) || "";
  return place.slice(0, 50);
}

const digits = (s: string | null | undefined) => (s || "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
const unitCode = (soldBy: string | null) => (soldBy === "weight" ? "KGS" : soldBy === "volume" ? "LTR" : "NOS");
const ddmmyyyy = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 330 * 60000); // India time
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
};

/** What stops a bill from being e-invoiced. Empty means it is ready. */
export function problems(bill: EInvBill, seller: StoreDetails): string[] {
  const out: string[] = [];
  if (!seller.gstin || !isValidGstin(seller.gstin)) out.push("Shop GSTIN missing (Dashboard → Shop details on bills)");
  if (!seller.state_code) out.push("Shop state missing");
  if (!pinFrom(seller.address)) out.push("Shop address needs a 6-digit PIN code");
  if (!isValidGstin(bill.buyer.gstin)) out.push("Customer GSTIN looks wrong");
  if (!pinFrom(bill.buyer.address)) out.push("Customer address needs a 6-digit PIN code");
  if (bill.invoice.length > 16) out.push("Bill number is longer than 16 characters");
  if (!bill.lines.length) out.push("Bill has no items");
  if (bill.lines.some((l) => !/^\d{4,8}$/.test((l.hsn || "").trim()))) out.push("Some items have no HSN code (4 to 8 digits)");
  return out;
}

export function toNicJson(bill: EInvBill, seller: StoreDetails) {
  const sellerState = seller.state_code || "";
  const buyerState = bill.buyer.stateCode || bill.buyer.gstin.slice(0, 2);
  const items = bill.lines.map((l, i) => {
    const qty = r3(l.quantity);
    const ass = r2(l.total - l.gst);
    let unitPrice = r3(l.unitPrice);
    let totAmt = r2(unitPrice * qty);
    if (totAmt < ass) { totAmt = ass; unitPrice = r3(ass / (qty || 1)); }
    const gst = r2(l.gst);
    const half = r2(gst / 2);
    return {
      SlNo: String(i + 1),
      PrdDesc: (l.name || "Item").slice(0, 300),
      IsServc: "N",
      HsnCd: (l.hsn || "").trim(),
      Qty: qty,
      Unit: unitCode(l.soldBy),
      UnitPrice: unitPrice,
      TotAmt: totAmt,
      Discount: r2(totAmt - ass),
      AssAmt: ass,
      GstRt: Number(l.gstRate || 0),
      IgstAmt: bill.interstate ? gst : 0,
      CgstAmt: bill.interstate ? 0 : half,
      SgstAmt: bill.interstate ? 0 : r2(gst - half),
      CesRt: 0, CesAmt: 0, CesNonAdvlAmt: 0, StateCesRt: 0, StateCesAmt: 0, StateCesNonAdvlAmt: 0, OthChrg: 0,
      TotItemVal: r2(l.total),
    };
  });
  const sumOf = (k: keyof (typeof items)[number]) => r2(items.reduce((a, it) => a + Number(it[k]), 0));
  const itemsTotal = sumOf("TotItemVal");
  const sellerPh = digits(seller.phone?.split(",")[0]);
  const buyerPh = digits(bill.buyer.phone);
  return {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: "B2B", RegRev: "N", IgstOnIntra: "N" },
    DocDtls: { Typ: "INV", No: bill.invoice, Dt: ddmmyyyy(bill.date) },
    SellerDtls: {
      Gstin: (seller.gstin || "").toUpperCase(),
      LglNm: seller.business_name.slice(0, 100),
      Addr1: (seller.address || "").slice(0, 100),
      Loc: placeFrom(seller.address, sellerState),
      Pin: pinFrom(seller.address),
      Stcd: sellerState,
      ...(sellerPh.length >= 6 && sellerPh.length <= 12 ? { Ph: sellerPh } : {}),
      ...(seller.email ? { Em: seller.email } : {}),
    },
    BuyerDtls: {
      Gstin: bill.buyer.gstin.toUpperCase(),
      LglNm: bill.buyer.name.slice(0, 100),
      Pos: buyerState,
      Addr1: (bill.buyer.address || "").slice(0, 100),
      Loc: placeFrom(bill.buyer.address, buyerState),
      Pin: pinFrom(bill.buyer.address),
      Stcd: buyerState,
      ...(buyerPh.length >= 6 && buyerPh.length <= 12 ? { Ph: buyerPh } : {}),
      ...(bill.buyer.email ? { Em: bill.buyer.email } : {}),
    },
    ItemList: items,
    ValDtls: {
      AssVal: sumOf("AssAmt"),
      CgstVal: sumOf("CgstAmt"),
      SgstVal: sumOf("SgstAmt"),
      IgstVal: sumOf("IgstAmt"),
      CesVal: 0, StCesVal: 0, Discount: 0, OthChrg: 0,
      RndOffAmt: r2(bill.total - itemsTotal),
      TotInvVal: r2(bill.total),
    },
  };
}

/** Pull IRN, Ack no, Ack date and signed QR out of what the portal gave back (JSON, or plain text). */
export function parsePortalReply(text: string): { irn?: string; ackNo?: string; ackDate?: string; signedQr?: string } {
  const found: Record<string, string> = {};
  const want: Record<string, string> = { irn: "irn", ackno: "ackNo", ackdt: "ackDate", ackdate: "ackDate", signedqrcode: "signedQr", signedqr: "signedQr" };
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const key = want[k.toLowerCase().replace(/[^a-z]/g, "")];
      if (key && (typeof val === "string" || typeof val === "number") && !found[key]) found[key] = String(val);
      else if (typeof val === "string" && /^\s*[[{]/.test(val)) { try { walk(JSON.parse(val)); } catch { /* not JSON */ } }
      else walk(val);
    }
  };
  try { walk(JSON.parse(text)); } catch { /* not JSON: look for the pieces in the text */ }
  if (!found.irn) { const m = text.match(/\b[0-9a-fA-F]{64}\b/); if (m) found.irn = m[0]; }
  if (!found.signedQr) { const m = text.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/); if (m) found.signedQr = m[0]; }
  if (!found.ackNo) { const m = text.match(/\b\d{15}\b/); if (m) found.ackNo = m[0]; }
  return { irn: found.irn?.toLowerCase(), ackNo: found.ackNo, ackDate: found.ackDate, signedQr: found.signedQr };
}

/** "2026-11-27 12:34:00" (portal, India time) or an ISO date → ISO, or null. */
export function ackDateIso(s: string | undefined | null): string | null {
  if (!s) return null;
  const t = s.trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - 330 * 60000).toISOString();
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const money = (n: number) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A4 e-invoice with IRN and the signed QR code. */
export async function printEInvoice(bill: EInvBill, seller: StoreDetails, rec: EInvRecord) {
  const w = window.open("", "_blank");
  if (!w) throw new Error("Allow pop-ups to print");
  const j = toNicJson(bill, seller);
  let qr = "";
  if (rec.signed_qr) {
    try {
      const [{ QRCodeSVG }, { renderToStaticMarkup }, { createElement }] = await Promise.all([import("qrcode.react"), import("react-dom/server"), import("react")]);
      qr = renderToStaticMarkup(createElement(QRCodeSVG, { value: rec.signed_qr, size: 150, level: "L" }));
    } catch { qr = ""; }
  }
  const v = j.ValDtls;
  const rows = j.ItemList.map((it) => `<tr><td>${it.SlNo}</td><td>${esc(it.PrdDesc)}</td><td>${esc(it.HsnCd)}</td><td class="r">${it.Qty} ${it.Unit}</td><td class="r">${money(it.UnitPrice)}</td><td class="r">${money(it.Discount)}</td><td class="r">${money(it.AssAmt)}</td><td class="r">${it.GstRt}%</td><td class="r">${money(it.TotItemVal)}</td></tr>`).join("");
  const ack = rec.ack_date ? new Date(rec.ack_date).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "";
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>e-Invoice ${esc(bill.invoice)}</title><style>
  body{font-family:Arial,sans-serif;font-size:12px;margin:24px;color:#000} h1{font-size:18px;margin:0 0 4px}
  table{border-collapse:collapse;width:100%} td,th{border:1px solid #999;padding:4px;vertical-align:top} th{background:#eee;text-align:left}
  .r{text-align:right} .top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start} .box{border:1px solid #999;padding:8px;flex:1}
  .irn{word-break:break-all;font-family:monospace;font-size:11px} .muted{color:#555}
  ${rec.status === "cancelled" ? "body::before{content:'IRN CANCELLED';position:fixed;top:40%;left:15%;font-size:72px;color:rgba(200,0,0,.2);transform:rotate(-20deg)}" : ""}
  @page{size:A4;margin:12mm}</style></head><body>
  <div class="top"><div><h1>Tax Invoice (e-Invoice)</h1>
  <div><b>IRN:</b> <span class="irn">${esc(rec.irn)}</span></div>
  ${rec.ack_no ? `<div><b>Ack No:</b> ${esc(rec.ack_no)} &nbsp; <b>Ack Date:</b> ${esc(ack)}</div>` : ""}
  <div><b>Invoice No:</b> ${esc(j.DocDtls.No)} &nbsp; <b>Date:</b> ${esc(j.DocDtls.Dt)} &nbsp; <b>Supply:</b> B2B</div></div>
  <div>${qr || '<div class="muted">No signed QR saved</div>'}</div></div>
  <div class="top" style="margin-top:12px">
  <div class="box"><b>Seller</b><br>${esc(j.SellerDtls.LglNm)}<br>GSTIN: ${esc(j.SellerDtls.Gstin)}<br>${esc(j.SellerDtls.Addr1)}<br>State: ${esc(stateName(j.SellerDtls.Stcd))} (${esc(j.SellerDtls.Stcd)})</div>
  <div class="box"><b>Buyer</b><br>${esc(j.BuyerDtls.LglNm)}<br>GSTIN: ${esc(j.BuyerDtls.Gstin)}<br>${esc(j.BuyerDtls.Addr1)}<br>Place of supply: ${esc(stateName(j.BuyerDtls.Pos))} (${esc(j.BuyerDtls.Pos)})</div></div>
  <table style="margin-top:12px"><tr><th>#</th><th>Item</th><th>HSN</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Discount</th><th class="r">Taxable</th><th class="r">GST</th><th class="r">Total</th></tr>${rows}</table>
  <table style="margin-top:8px;width:50%;margin-left:auto">
  <tr><td>Taxable value</td><td class="r">${money(v.AssVal)}</td></tr>
  ${v.IgstVal ? `<tr><td>IGST</td><td class="r">${money(v.IgstVal)}</td></tr>` : `<tr><td>CGST</td><td class="r">${money(v.CgstVal)}</td></tr><tr><td>SGST</td><td class="r">${money(v.SgstVal)}</td></tr>`}
  ${v.RndOffAmt ? `<tr><td>Round off</td><td class="r">${money(v.RndOffAmt)}</td></tr>` : ""}
  <tr><td><b>Invoice total</b></td><td class="r"><b>Rs ${money(v.TotInvVal)}</b></td></tr></table>
  ${rec.status === "cancelled" ? `<p><b>IRN cancelled:</b> ${esc(rec.cancel_reason)}</p>` : ""}
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}
