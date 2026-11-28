// Offers (automatic discounts), bill discounts and loyalty point helpers. Pure functions.

export interface Offer {
  id: string;
  name: string;
  percent: number | null;
  // newer database only
  offer_type?: "percent" | "flat" | "bxgy";
  flat_amount?: number | null;  // rupees off each unit
  buy_qty?: number | null;      // Buy X ...
  get_qty?: number | null;      // ... get Y free
  min_bill?: number | null;     // only on bills of at least this much
  product_id: string | null;
  category: string | null;
  min_qty: number;
  starts_on: string | null; // YYYY-MM-DD
  ends_on: string | null;
  is_active: boolean;
}

export const isOfferLive = (o: Offer, today: string) =>
  o.is_active && (!o.starts_on || o.starts_on <= today) && (!o.ends_on || o.ends_on >= today);

/**
 * Discount % an offer gives on one line. Buy X Get Y: of every X+Y units,
 * Y are free. Flat: rupees off each unit. Never more than 90%.
 */
export function offerPercent(o: Offer, price: number, qty: number): number {
  const type = o.offer_type || "percent";
  let pct = 0;
  if (type === "flat") pct = price > 0 ? (Number(o.flat_amount || 0) / price) * 100 : 0;
  else if (type === "bxgy") {
    const b = Number(o.buy_qty || 0), g = Number(o.get_qty || 0);
    const free = b > 0 && g > 0 && qty > 0 ? Math.floor(qty / (b + g)) * g : 0;
    pct = qty > 0 ? (free / qty) * 100 : 0;
  } else pct = Number(o.percent || 0);
  return Math.round(Math.min(Math.max(pct, 0), 90) * 10000) / 10000;
}

/** Short text for an offer, e.g. "Buy 2 get 1 free", "₹5 off each", "10% off". */
export function offerText(o: Offer): string {
  const type = o.offer_type || "percent";
  const base = type === "flat" ? `₹${Number(o.flat_amount || 0)} off each`
    : type === "bxgy" ? `Buy ${o.buy_qty} get ${o.get_qty} free`
    : `${Number(o.percent || 0)}% off`;
  return o.min_bill ? `${base} on bills of ₹${Number(o.min_bill)}+` : base;
}

/** Best live offer for a product at this quantity (and bill value), or null. */
export function bestOffer(
  product: { id: string; category?: string | null; price?: number },
  qty: number,
  offers: Offer[],
  today: string,
  billValue = Infinity,
): (Offer & { appliedPercent: number }) | null {
  const cat = (product.category || "").trim().toLowerCase();
  let best: (Offer & { appliedPercent: number }) | null = null;
  for (const o of offers) {
    if (!isOfferLive(o, today) || qty < (o.min_qty || 1)) continue;
    if (o.min_bill && billValue < Number(o.min_bill)) continue;
    const fits = o.product_id ? o.product_id === product.id
      : o.category ? o.category.trim().toLowerCase() === cat
      : true; // whole shop
    if (!fits) continue;
    const pct = offerPercent(o, Number(product.price || 0), qty);
    if (pct > 0 && (!best || pct > best.appliedPercent)) best = { ...o, appliedPercent: pct };
  }
  return best;
}

/** Discount % after an extra % off on top of the line's own discount. */
export const stackDiscount = (linePct: number, extraPct: number) =>
  extraPct > 0 ? Math.round((100 - (100 - linePct) * (100 - extraPct) / 100) * 10000) / 10000 : linePct;

/**
 * The extra % off the whole bill that gives `value` rupees off a bill of
 * `total`. Never more than 90% of the bill.
 */
export function pointsPercent(value: number, total: number): number {
  if (!(value > 0) || !(total > 0)) return 0;
  return Math.round(Math.min(value / total, 0.9) * 100 * 10000) / 10000;
}

/** Most points usable on a bill: balance, and at most half the bill. */
export function maxPointsForBill(balance: number, pointValue: number, total: number): number {
  if (!(pointValue > 0)) return 0;
  return Math.max(0, Math.min(Math.floor(balance), Math.floor((total * 0.5) / pointValue)));
}

/** A bill discount as % of the bill: ₹ amounts turn into a %, capped at 90%. */
export function billDiscountPercent(kind: "percent" | "flat", value: number, billTotal: number): number {
  if (!(value > 0) || !(billTotal > 0)) return 0;
  return kind === "percent" ? Math.round(Math.min(value, 90) * 10000) / 10000 : pointsPercent(value, billTotal);
}
