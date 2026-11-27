// Indian rupee notes and coins used when counting the cash drawer.
export const NOTES = [500, 200, 100, 50, 20, 10] as const;
export const COINS = [20, 10, 5, 2, 1] as const;

/** How many of each note and coin, keyed by face value ("500": 3). */
export interface CashCount {
  notes: Record<string, number>;
  coins: Record<string, number>;
}

export const emptyCount = (): CashCount => ({ notes: {}, coins: {} });

const sumPart = (part: Record<string, number> | undefined) =>
  Object.entries(part || {}).reduce((s, [face, qty]) => s + Number(face) * (Number(qty) || 0), 0);

export const notesTotal = (c: CashCount | null | undefined) => sumPart(c?.notes);
export const coinsTotal = (c: CashCount | null | undefined) => sumPart(c?.coins);
export const countTotal = (c: CashCount | null | undefined) => notesTotal(c) + coinsTotal(c);

export const countPieces = (c: CashCount | null | undefined) =>
  [...Object.values(c?.notes || {}), ...Object.values(c?.coins || {})].reduce((s, q) => s + (Number(q) || 0), 0);

/** Drops zero rows so what we save stays small. */
export function cleanCount(c: CashCount): CashCount {
  const keep = (p: Record<string, number>) =>
    Object.fromEntries(Object.entries(p).filter(([, q]) => Number(q) > 0).map(([f, q]) => [f, Math.floor(Number(q))]));
  return { notes: keep(c.notes), coins: keep(c.coins) };
}

export const rupees = (n: unknown) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
