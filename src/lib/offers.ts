// Offers (automatic % discounts) and loyalty point helpers. Pure functions.

export interface Offer {
  id: string;
  name: string;
  percent: number;
  product_id: string | null;
  category: string | null;
  min_qty: number;
  starts_on: string | null; // YYYY-MM-DD
  ends_on: string | null;
  is_active: boolean;
}

export const isOfferLive = (o: Offer, today: string) =>
  o.is_active && (!o.starts_on || o.starts_on <= today) && (!o.ends_on || o.ends_on >= today);

/** Best live offer for a product at this quantity, or null. */
export function bestOffer(
  product: { id: string; category?: string | null },
  qty: number,
  offers: Offer[],
  today: string,
): Offer | null {
  const cat = (product.category || "").trim().toLowerCase();
  let best: Offer | null = null;
  for (const o of offers) {
    if (!isOfferLive(o, today) || qty < (o.min_qty || 1)) continue;
    const fits = o.product_id ? o.product_id === product.id
      : o.category ? o.category.trim().toLowerCase() === cat
      : true; // whole shop
    if (fits && (!best || Number(o.percent) > Number(best.percent))) best = o;
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
