// Shared shape for report exports (CSV, Excel, PDF, print): metadata lines
// (title, dates, store, filters, generated time) and rows keyed by column.
export interface ExportTable {
  /** File name without extension. */
  name: string;
  /** First line is the title; the rest describe the report. */
  meta: string[];
  rows: Record<string, unknown>[];
}

/** "net_sales_before" -> "Net sales before"; "gst_rate_pct" -> "GST rate %". */
export function columnLabel(key: string): string {
  const words = key.split("_").map((w) => (w === "pct" ? "%" : w));
  const acr = new Set(["gst", "cgst", "sgst", "igst", "hsn", "upi", "mrp", "sku", "id", "b2b", "b2c", "gstin"]);
  return words.map((w, i) => (acr.has(w) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

export const columnsOf = (rows: Record<string, unknown>[]) => (rows.length ? Object.keys(rows[0]) : []);

export const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Display text for one cell in PDF and print. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (isNumber(v)) return v.toLocaleString("en-IN", { maximumFractionDigits: 3 });
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
