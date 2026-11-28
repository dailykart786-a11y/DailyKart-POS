// Pure helpers to turn a month's bills, returns and purchases into the
// numbers a CA needs for GSTR-1 and GSTR-3B. No database calls here.

export interface SaleLine {
  invoice: string;
  date: string;
  interstate: boolean;
  customerName: string | null;
  customerGstin: string | null;
  customerState: string | null;
  hsn: string | null;
  rate: number;
  quantity: number;
  taxable: number;
  tax: number;
}

export interface ReturnLine extends SaleLine {
  creditNote: string;
}

export interface PurchaseLine {
  supplier: string;
  supplierGstin: string | null;
  billNumber: string | null;
  date: string;
  interstate: boolean;
  rate: number;
  taxable: number;
  tax: number;
}

export interface TaxSplit { taxable: number; cgst: number; sgst: number; igst: number; }

const r2 = (n: number) => Math.round(n * 100) / 100;

export function split(taxable: number, tax: number, interstate: boolean): TaxSplit {
  if (interstate) return { taxable: r2(taxable), cgst: 0, sgst: 0, igst: r2(tax) };
  const half = Math.floor((tax * 100) / 2) / 100;
  return { taxable: r2(taxable), cgst: r2(tax - half), sgst: r2(half), igst: 0 };
}

export function add(a: TaxSplit, b: TaxSplit): TaxSplit {
  return { taxable: r2(a.taxable + b.taxable), cgst: r2(a.cgst + b.cgst), sgst: r2(a.sgst + b.sgst), igst: r2(a.igst + b.igst) };
}

export const ZERO: TaxSplit = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
export const totalTax = (t: TaxSplit) => r2(t.cgst + t.sgst + t.igst);

export function byRate<T extends { rate: number; taxable: number; tax: number; interstate: boolean }>(lines: T[]) {
  const m = new Map<number, TaxSplit>();
  for (const l of lines) m.set(l.rate, add(m.get(l.rate) || ZERO, split(l.taxable, l.tax, l.interstate)));
  return Array.from(m.entries()).sort((a, b) => a[0] - b[0]).map(([rate, t]) => ({ rate, ...t }));
}

export function sum<T extends { taxable: number; tax: number; interstate: boolean }>(lines: T[]): TaxSplit {
  return lines.reduce((acc, l) => add(acc, split(l.taxable, l.tax, l.interstate)), ZERO);
}

/** HSN summary (GSTR-1 table 12). Returns are subtracted. */
export function hsnSummary(sales: SaleLine[], returns: ReturnLine[]) {
  const m = new Map<string, { hsn: string; rate: number; quantity: number } & TaxSplit>();
  const put = (l: SaleLine, sign: 1 | -1) => {
    const key = `${l.hsn || "NO HSN"}|${l.rate}`;
    const cur = m.get(key) || { hsn: l.hsn || "NO HSN", rate: l.rate, quantity: 0, ...ZERO };
    const t = split(l.taxable * sign, l.tax * sign, l.interstate);
    m.set(key, { ...cur, quantity: Math.round((cur.quantity + l.quantity * sign) * 1000) / 1000, ...add(cur, t) });
  };
  sales.forEach((l) => put(l, 1));
  returns.forEach((l) => put(l, -1));
  return Array.from(m.values()).sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate);
}

/** B2B invoices: one row per invoice and rate, for customers with a GSTIN. */
export function b2bInvoices(sales: SaleLine[]) {
  const m = new Map<string, { invoice: string; date: string; gstin: string; name: string; rate: number; interstate: boolean } & TaxSplit & { value: number }>();
  for (const l of sales) {
    if (!l.customerGstin) continue;
    const key = `${l.invoice}|${l.rate}`;
    const cur = m.get(key) || { invoice: l.invoice, date: l.date, gstin: l.customerGstin, name: l.customerName || "", rate: l.rate, interstate: l.interstate, ...ZERO, value: 0 };
    const t = add(cur, split(l.taxable, l.tax, l.interstate));
    m.set(key, { ...cur, ...t, value: r2(cur.value + l.taxable + l.tax) });
  }
  return Array.from(m.values()).sort((a, b) => a.date.localeCompare(b.date) || a.invoice.localeCompare(b.invoice));
}

/** Rows to CSV text (Excel opens it). */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}

export function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
