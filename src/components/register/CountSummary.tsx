import { COINS, NOTES, type CashCount, rupees } from "@/lib/cashCount";

/** Read-only list of the notes and coins that were counted. */
export function CountSummary({ count }: { count: CashCount | null | undefined }) {
  if (!count) return null;
  const items = [
    ...NOTES.map((f) => ({ label: `₹${f} note`, face: f, qty: Number(count.notes?.[f] || 0) })),
    ...COINS.map((f) => ({ label: `₹${f} coin`, face: f, qty: Number(count.coins?.[f] || 0) })),
  ].filter((i) => i.qty > 0);
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No notes or coins recorded.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <span key={i.label} className="rounded border bg-background px-2 py-0.5 text-xs tabular-nums">
          {i.label} × {i.qty} = {rupees(i.qty * i.face)}
        </span>
      ))}
    </div>
  );
}
