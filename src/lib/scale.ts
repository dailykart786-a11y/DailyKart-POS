// Weighing-scale labels. A scale prints a 13-digit EAN barcode:
//   <prefix><item code (PLU)><weight in grams, or price in paise><check digit>
// e.g. prefix "21", 5-digit code 00123, weight 00750 g -> 2100123007506
export interface ScaleSettings { prefix: string; value: "weight" | "price"; codeDigits: number; }
export interface ScaleRead { plu: string; grams?: number; paise?: number; }

/** EAN-13 check digit is right */
export function ean13Ok(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  const d = code.split("").map(Number);
  const sum = d.slice(0, 12).reduce((s, n, i) => s + n * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === d[12];
}

/** Reads a scale label, or null when the code isn't one. */
export function parseScaleBarcode(raw: string, s: ScaleSettings | null): ScaleRead | null {
  if (!s || !s.prefix) return null;
  const code = raw.trim();
  if (!/^\d{13}$/.test(code) || !code.startsWith(s.prefix)) return null;
  const digits = Math.min(Math.max(s.codeDigits || 5, 4), 6);
  const valueLen = 12 - s.prefix.length - digits;
  if (valueLen < 3) return null;
  if (!ean13Ok(code)) return null;
  const plu = code.slice(s.prefix.length, s.prefix.length + digits);
  const value = parseInt(code.slice(s.prefix.length + digits, 12), 10);
  if (!(value > 0)) return null;
  return s.value === "price" ? { plu, paise: value } : { plu, grams: value };
}

/** Same item code, with or without leading zeros */
export const samePlu = (a: string | null | undefined, b: string) => !!a && a.replace(/^0+/, "") === b.replace(/^0+/, "");

export const isLoose = (soldBy: string | null | undefined) => soldBy === "weight" || soldBy === "volume";
export const looseUnit = (soldBy: string | null | undefined) => (soldBy === "volume" ? "L" : soldBy === "weight" ? "kg" : "");
/** 0.75 kg -> "750 g", 2.5 kg -> "2.5 kg" */
export function qtyText(qty: number, soldBy: string | null | undefined): string {
  if (!isLoose(soldBy)) return String(qty);
  const small = soldBy === "volume" ? "ml" : "g";
  return qty < 1 ? `${Math.round(qty * 1000)} ${small}` : `${Math.round(qty * 1000) / 1000} ${looseUnit(soldBy)}`;
}
