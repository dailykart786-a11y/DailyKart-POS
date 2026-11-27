import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { rupees } from "@/lib/statement";

interface Row { at: string; kind: string; ref: string | null; amount: number | null; points: number; }
const KIND: Record<string, string> = { opening: "Opening points", earned: "Earned on bill", returned: "Taken back (return)", used: "Used on bill" };

/** Points earned, taken back and used, bill by bill. */
export function LoyaltyHistoryDialog({ customerId, name, onClose }: { customerId: string; name: string; onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    (async () => {
      const [h, b] = await Promise.all([
        supabase.rpc("loyalty_ledger" as any, { p_customer_id: customerId } as any),
        supabase.from("customer_loyalty" as any).select("balance").eq("customer_id", customerId).maybeSingle(),
      ]);
      if (h.error) { setFailed(true); return; }
      setRows(((h.data || []) as any[]).map((r) => ({ ...r, amount: r.amount == null ? null : Number(r.amount), points: Number(r.points) })));
      if (!b.error && b.data) setBalance(Number((b.data as any).balance) || 0);
    })();
  }, [customerId]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Points history · {name}</DialogTitle></DialogHeader>
        {failed ? <p className="text-sm text-muted-foreground">Points history needs the latest database update (dailykart-updates.sql).</p>
          : rows === null ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <div className="space-y-2">
            {balance !== null && <p className="text-sm">Points now: <b>{balance}</b></p>}
            {rows.length === 0 ? <p className="text-sm text-muted-foreground">No points yet</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>What</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Points</TableHead></TableRow></TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm whitespace-nowrap">{new Date(r.at).toLocaleDateString("en-IN")}</TableCell>
                      <TableCell className="text-sm">{KIND[r.kind] || r.kind}{r.ref ? <span className="block text-xs text-muted-foreground">{r.ref}</span> : null}</TableCell>
                      <TableCell className="text-right text-sm">{r.amount == null ? "" : rupees(r.amount)}</TableCell>
                      <TableCell className={`text-right font-medium ${r.points < 0 ? "text-red-600" : "text-green-700"}`}>{r.points > 0 ? `+${r.points}` : r.points}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="text-xs text-muted-foreground">Points are worked out on the total spend, so the balance can differ by a point from adding up each bill.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
