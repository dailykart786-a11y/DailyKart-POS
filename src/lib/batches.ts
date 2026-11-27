// Batch / expiry helpers. Sales don't record a batch, so what is left of
// each batch is worked out assuming the oldest stock is sold first: the
// current stock belongs to the newest batches.

export interface Batch {
  id: string;
  product_id: string;
  batch_no: string | null;
  expiry_date: string | null; // YYYY-MM-DD
  quantity: number;
  created_at: string;
  cleared_at: string | null;
}

export interface BatchLeft extends Batch {
  left: number;
}

/** Splits a product's current stock over its open batches, newest first. */
export function estimateLeft(batches: Batch[], stock: number): BatchLeft[] {
  let remaining = Math.max(0, stock);
  return batches
    .filter((b) => !b.cleared_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((b) => {
      const left = Math.min(b.quantity, remaining);
      remaining -= left;
      return { ...b, left };
    });
}

export const todayIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const daysUntil = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = todayIso().split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
};

/** Groups batches by product and estimates what's left. */
export function batchesWithLeft(batches: Batch[], stockById: Record<string, number>): BatchLeft[] {
  const by: Record<string, Batch[]> = {};
  for (const b of batches) (by[b.product_id] ||= []).push(b);
  return Object.entries(by).flatMap(([pid, list]) => estimateLeft(list, stockById[pid] ?? 0));
}
