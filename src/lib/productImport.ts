// Product import from Excel (.xlsx) or CSV: turns sheet rows into checked
// product records. Pure functions, no database access.

export interface ImportExisting {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
}

export interface ImportRow {
  row: number; // line number in the sheet, for messages
  name: string;
  sku: string;
  barcode: string | null;
  category: string | null;
  price: number;
  cost_price: number;
  gst_rate: number;
  hsn_code: string | null;
  stock_quantity: number;
  min_stock_level: number;
  base_unit: string;
  /** Matching product already in the store, if any */
  existingId: string | null;
  errors: string[];
}

// Header names people commonly use, all compared lower-case without spaces/symbols
const ALIASES: Record<string, string[]> = {
  name: ["name", "product", "productname", "item", "itemname", "description"],
  sku: ["sku", "code", "itemcode", "productcode"],
  barcode: ["barcode", "ean", "upc", "barcodeno", "barcodenumber"],
  category: ["category", "group", "department"],
  price: ["price", "mrp", "sellingprice", "saleprice", "rate", "sp"],
  cost_price: ["cost", "costprice", "purchaseprice", "buyprice", "cp"],
  gst_rate: ["gst", "gstrate", "gst%", "tax", "taxrate", "gstpercent"],
  hsn_code: ["hsn", "hsncode", "hsnsac", "sac"],
  stock_quantity: ["stock", "qty", "quantity", "stockqty", "openingstock", "instock"],
  min_stock_level: ["min", "minstock", "minimum", "reorderlevel", "minstocklevel", "reorder"],
  base_unit: ["unit", "uom", "baseunit"],
};

const norm = (h: unknown) => String(h ?? "").toLowerCase().replace(/[^a-z0-9%]/g, "");

export const TEMPLATE_HEADERS = ["Name", "SKU", "Barcode", "Category", "Price", "Cost price", "GST %", "HSN", "Stock", "Min stock", "Unit"];

/** Which column holds which field. Returns null for fields not found. */
export function mapHeaders(header: unknown[]): Record<string, number | null> {
  const cols = header.map(norm);
  const out: Record<string, number | null> = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const i = cols.findIndex((c) => names.includes(c));
    out[field] = i >= 0 ? i : null;
  }
  return out;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[₹,\s]/g, "").replace(/%$/, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const text = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  // Excel stores long barcodes as numbers: print them without exponent
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v).trim();
};

const makeSku = (name: string, i: number) =>
  (name.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "ITEM") + "-" + String(i).padStart(4, "0");

/** Turns sheet rows (first row = headers) into checked products. */
export function parseProductRows(rows: unknown[][], existing: ImportExisting[]): { rows: ImportRow[]; missingColumns: string[] } {
  if (!rows.length) return { rows: [], missingColumns: ["name", "price"] };
  const map = mapHeaders(rows[0]);
  const missingColumns = ["name", "price"].filter((f) => map[f] === null);
  if (missingColumns.length) return { rows: [], missingColumns };

  const byBarcode = new Map(existing.filter((p) => p.barcode).map((p) => [String(p.barcode).toLowerCase(), p]));
  const bySku = new Map(existing.map((p) => [p.sku.toLowerCase(), p]));
  const byName = new Map(existing.map((p) => [p.name.trim().toLowerCase(), p]));
  const seenBarcode = new Map<string, number>();
  const seenSku = new Map<string, number>();

  const get = (r: unknown[], f: string) => (map[f] === null ? undefined : r[map[f] as number]);
  const out: ImportRow[] = [];

  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    if (!r || r.every((c) => c === null || c === undefined || String(c).trim() === "")) return;
    const errors: string[] = [];
    const name = text(get(r, "name"));
    if (!name) errors.push("Name is empty");
    const price = num(get(r, "price"));
    if (price === null || price < 0) errors.push("Price is missing or not a number");
    const costRaw = num(get(r, "cost_price"));
    if (costRaw !== null && costRaw < 0) errors.push("Cost can't be negative");
    const gstRaw = num(get(r, "gst_rate"));
    const gst = gstRaw === null ? 0 : gstRaw > 0 && gstRaw < 1 ? Math.round(gstRaw * 10000) / 100 : gstRaw; // 0.18 -> 18
    if (gst < 0 || gst > 40) errors.push("GST % should be between 0 and 40");
    const stockRaw = num(get(r, "stock_quantity"));
    if (stockRaw !== null && (stockRaw < 0 || !Number.isInteger(stockRaw))) errors.push("Stock should be a whole number, 0 or more");
    const minRaw = num(get(r, "min_stock_level"));
    if (minRaw !== null && (minRaw < 0 || !Number.isInteger(minRaw))) errors.push("Min stock should be a whole number");
    const barcode = text(get(r, "barcode")) || null;
    let sku = text(get(r, "sku"));
    const hsn = text(get(r, "hsn_code")).replace(/\s/g, "") || null;
    if (hsn && !/^\d{4,8}$/.test(hsn)) errors.push("HSN should be 4 to 8 digits");

    const match = (barcode && byBarcode.get(barcode.toLowerCase()))
      || (sku && bySku.get(sku.toLowerCase()))
      || (!barcode && !sku ? byName.get(name.toLowerCase()) : undefined)
      || null;
    if (!sku) sku = match?.sku || makeSku(name, line);

    if (barcode) {
      const k = barcode.toLowerCase();
      if (seenBarcode.has(k)) errors.push(`Same barcode as line ${seenBarcode.get(k)}`);
      else seenBarcode.set(k, line);
    }
    const sk = sku.toLowerCase();
    if (seenSku.has(sk)) errors.push(`Same SKU as line ${seenSku.get(sk)}`);
    else seenSku.set(sk, line);

    out.push({
      row: line,
      name,
      sku,
      barcode,
      category: text(get(r, "category")) || null,
      price: Math.round((price ?? 0) * 100) / 100,
      cost_price: Math.round((costRaw ?? 0) * 100) / 100,
      gst_rate: gst,
      hsn_code: hsn,
      stock_quantity: stockRaw ?? 0,
      min_stock_level: minRaw ?? 10,
      base_unit: text(get(r, "base_unit")) || "pc",
      existingId: match?.id || null,
      errors,
    });
  });
  return { rows: out, missingColumns: [] };
}

/** Minimal CSV reader (handles quotes, commas and new lines inside quotes). */
export function parseCsv(input: string): string[][] {
  const s = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
