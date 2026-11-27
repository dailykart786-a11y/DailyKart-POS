import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/hooks/useStore";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "@/hooks/use-toast";
import { supplierLedger, withRunning, printStatement, rupees, type LedgerEntry, type LedgerRow } from "@/lib/statement";
import { istToday } from "@/lib/dailySummary";
import { Printer, Undo2, X } from "lucide-react";

export interface SupplierInfo {
  supplier_id: string; name: string; phone: string | null; location_id?: string;
  balance: number; opening_balance?: number; credit_days?: number | null;
}

/** A supplier's purchases and payments, credit terms, reversal and printable statement. */
export function SupplierLedgerCard({ supplier, onClose, onChanged }: { supplier: SupplierInfo; onClose: () => void; onChanged: () => void }) {
  const { stores } = useStore();
  const { role } = useUserRole();
  const canReverse = role === "admin" || role === "manager" || role === "accountant" || role === "inventory";
  const canTerms = role === "admin" || role === "manager" || role === "accountant";
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [from, setFrom] = useState(`${istToday().slice(0, 8)}01`);
  const [to, setTo] = useState(istToday());
  const [opening, setOpening] = useState(supplier.opening_balance ? String(supplier.opening_balance) : "");
  const [days, setDays] = useState(supplier.credit_days != null ? String(supplier.credit_days) : "");
  const [reversing, setReversing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async (open = supplier.opening_balance || 0) => {
    const list = await supplierLedger(supplier.supplier_id, open);
    setEntries(list);
    setRows(withRunning(list).reverse());
  };

  useEffect(() => {
    load();
    setOpening(supplier.opening_balance ? String(supplier.opening_balance) : "");
    setDays(supplier.credit_days != null ? String(supplier.credit_days) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier.supplier_id]);

  const saveTerms = async () => {
    const o = Math.round((Number(opening) || 0) * 100) / 100;
    const d = days.trim() === "" ? null : Number(days);
    if (d != null && (!Number.isInteger(d) || d < 0 || d > 365)) { toast({ title: "Credit days are 0 to 365", variant: "destructive" }); return; }
    setBusy(true);
    const { error } = await supabase.from("suppliers").update({ opening_balance: o, credit_days: d } as any).eq("id", supplier.supplier_id);
    setBusy(false);
    if (error) {
      toast({ title: "Not saved", description: /opening_balance|credit_days|column/.test(error.message || "") ? "Ask your admin to run the latest dailykart-updates.sql first" : error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Saved", description: `Terms for ${supplier.name}` });
    await load(o);
    onChanged();
  };

  const reverse = async (id: string) => {
    if (!reason.trim()) { toast({ title: "Write why it is being reversed", variant: "destructive" }); return; }
    setBusy(true);
    const { error } = await supabase.rpc("reverse_supplier_payment" as any, { p_payment_id: id, p_reason: reason.trim() } as any);
    setBusy(false);
    if (error) {
      toast({ title: "Not reversed", description: error.code === "PGRST202" ? "Ask your admin to run the latest dailykart-updates.sql first" : error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Payment reversed", description: "The original entry stays, crossed out" });
    setReversing(null); setReason("");
    await load();
    onChanged();
  };

  const print = () => {
    if (from > to) { toast({ title: "The start date is after the end date", variant: "destructive" }); return; }
    const ok = printStatement({
      shop: stores.find((s) => s.id === supplier.location_id)?.name || "DailyKart",
      party: supplier.name, phone: supplier.phone, from, to, entries,
      debitLabel: "Bought", creditLabel: "Paid", owedLabel: "You owe",
    });
    if (!ok) toast({ title: "Allow pop-ups to print", variant: "destructive" });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">{supplier.name}: ledger (you owe {rupees(supplier.balance)})</CardTitle>
        <Button size="icon" variant="ghost" aria-label="Close ledger" onClick={onClose}><X className="h-4 w-4" /></Button>
      </CardHeader>
      <CardContent className="space-y-4 overflow-x-auto">
        <div className="flex flex-wrap items-end gap-2">
          {canTerms && (
            <>
              <div className="space-y-1">
                <Label htmlFor="sl-open">Opening balance (₹)</Label>
                <Input id="sl-open" type="number" step="0.01" className="w-36" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sl-days">Credit days</Label>
                <Input id="sl-days" type="number" min="0" max="365" className="w-28" value={days} onChange={(e) => setDays(e.target.value)} placeholder="None" />
              </div>
              <Button variant="outline" disabled={busy} onClick={saveTerms}>Save terms</Button>
            </>
          )}
          <div className="space-y-1">
            <Label htmlFor="sl-from">From</Label>
            <Input id="sl-from" type="date" className="w-40" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sl-to">To</Label>
            <Input id="sl-to" type="date" className="w-40" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </div>
          <Button variant="outline" className="gap-2" onClick={print}><Printer className="h-4 w-4" /> Print statement</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Entry</TableHead>
              <TableHead className="text-right">Bought</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">You owe</TableHead>
              {canReverse && <TableHead></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No entries yet</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={`${r.kind}-${r.id}`} className={r.reversed ? "text-muted-foreground" : ""}>
                <TableCell className="whitespace-nowrap">{r.kind === "opening" ? "Opening" : new Date(r.at).toLocaleDateString("en-IN")}</TableCell>
                <TableCell>
                  <span className={r.reversed ? "line-through" : ""}>{r.label}</span>
                  {r.reversed && <div className="text-xs">Reversed{r.reversed.reason ? `: ${r.reversed.reason}` : ""}</div>}
                  {reversing === r.paymentId && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Input className="h-8 w-56" aria-label="Why reverse" placeholder="Why? e.g. cheque bounced" value={reason} onChange={(e) => setReason(e.target.value)} />
                      <Button size="sm" variant="destructive" disabled={busy} onClick={() => reverse(r.paymentId!)}>Reverse</Button>
                      <Button size="sm" variant="ghost" onClick={() => setReversing(null)}>Cancel</Button>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">{r.debit ? rupees(r.debit) : ""}</TableCell>
                <TableCell className={`text-right ${r.reversed ? "line-through" : ""}`}>{r.credit ? rupees(r.credit) : ""}</TableCell>
                <TableCell className="text-right font-medium">{rupees(r.running)}</TableCell>
                {canReverse && (
                  <TableCell className="text-right">
                    {r.kind === "payment" && !r.reversed && reversing !== r.paymentId && (
                      <Button size="sm" variant="ghost" aria-label="Reverse this payment" onClick={() => { setReversing(r.paymentId!); setReason(""); }}>
                        <Undo2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
