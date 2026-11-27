import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Banknote, Coins, RotateCcw } from "lucide-react";
import { COINS, NOTES, type CashCount, coinsTotal, countTotal, notesTotal, rupees } from "@/lib/cashCount";

interface Props {
  value: CashCount;
  onChange: (next: CashCount) => void;
  idPrefix: string;
}

/** Count the drawer note by note and coin by coin; totals add up as you type. */
export function CashCounter({ value, onChange, idPrefix }: Props) {
  const set = (kind: "notes" | "coins", face: number, raw: string) => {
    const qty = Math.max(0, Math.floor(Number(raw) || 0));
    onChange({ ...value, [kind]: { ...value[kind], [face]: qty } });
  };

  const rows = (kind: "notes" | "coins", faces: readonly number[]) =>
    faces.map((face) => {
      const qty = value[kind][face] || 0;
      const id = `${idPrefix}-${kind}-${face}`;
      return (
        <div key={face} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2">
          <label htmlFor={id} className="text-sm font-medium tabular-nums">₹{face}</label>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">×</span>
            <Input
              id={id}
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              placeholder="0"
              className="h-9 w-full max-w-[6.5rem] text-right tabular-nums"
              value={qty ? String(qty) : ""}
              onChange={(e) => set(kind, face, e.target.value)}
              onFocus={(e) => e.target.select()}
              aria-label={`Number of ₹${face} ${kind === "notes" ? "notes" : "coins"}`}
            />
          </div>
          <span className="text-sm tabular-nums text-right min-w-[6.5rem]">{qty ? rupees(qty * face) : "—"}</span>
        </div>
      );
    });

  const hasAny = countTotal(value) > 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-md border p-3">
          <p className="flex items-center gap-2 text-sm font-semibold"><Banknote className="h-4 w-4" /> Notes</p>
          {rows("notes", NOTES)}
          <div className="flex justify-between border-t pt-2 text-sm"><span className="text-muted-foreground">Notes total</span><span className="font-medium tabular-nums">{rupees(notesTotal(value))}</span></div>
        </div>
        <div className="space-y-2 rounded-md border p-3">
          <p className="flex items-center gap-2 text-sm font-semibold"><Coins className="h-4 w-4" /> Coins</p>
          {rows("coins", COINS)}
          <div className="flex justify-between border-t pt-2 text-sm"><span className="text-muted-foreground">Coins total</span><span className="font-medium tabular-nums">{rupees(coinsTotal(value))}</span></div>
        </div>
      </div>
      <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
        <span className="font-semibold">Cash total</span>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold tabular-nums">{rupees(countTotal(value))}</span>
          {hasAny && (
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => onChange({ notes: {}, coins: {} })} aria-label="Clear count">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
