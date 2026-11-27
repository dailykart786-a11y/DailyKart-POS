import JsBarcode from "jsbarcode";

export interface LabelProduct {
  name: string;
  price: number;
  sku: string;
  barcode?: string | null;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** A barcode for loose items: EAN-13 starting with 2 (shop's own range). */
export function generateShopBarcode(): string {
  let digits = "2";
  for (let i = 0; i < 11; i++) digits += Math.floor(Math.random() * 10);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  return digits + ((10 - (sum % 10)) % 10);
}

function barcodeSvg(code: string): string {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const isEan13 = /^\d{13}$/.test(code);
  try {
    JsBarcode(svg, code, { format: isEan13 ? "EAN13" : "CODE128", height: 40, fontSize: 12, margin: 0, width: 1.6 });
  } catch {
    JsBarcode(svg, code, { format: "CODE128", height: 40, fontSize: 12, margin: 0, width: 1.6 });
  }
  return svg.outerHTML;
}

/** Opens a print window with `copies` labels (50mm x 25mm) per product. */
export function printLabels(items: { product: LabelProduct; copies: number }[]): boolean {
  const labels = items.flatMap(({ product, copies }) => {
    const code = (product.barcode || product.sku || "").trim();
    if (!code) return [];
    const one = `<div class="label"><div class="name">${esc(product.name)}</div>${barcodeSvg(code)}<div class="price">MRP Rs ${Number(product.price).toFixed(2)}</div></div>`;
    return Array.from({ length: Math.max(1, copies) }, () => one);
  });
  if (!labels.length) return false;
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Barcode labels</title>
<style>
  @page { size: 50mm 25mm; margin: 0; }
  body { margin: 0; font-family: Arial, sans-serif; }
  .label { width: 50mm; height: 25mm; box-sizing: border-box; padding: 1mm 2mm; display: flex; flex-direction: column; align-items: center; justify-content: center; page-break-after: always; overflow: hidden; }
  .name { font-size: 9px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 46mm; }
  .price { font-size: 10px; font-weight: bold; }
  svg { max-width: 46mm; height: 14mm; }
</style></head><body>${labels.join("")}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 300);
  return true;
}
