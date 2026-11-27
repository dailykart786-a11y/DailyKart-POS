import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useStore, inStore } from "@/hooks/useStore";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { Landmark, LockOpen, Lock } from "lucide-react";

interface Totals {
  bills: number; total_sales: number; cash_sales: number; upi_sales: number; card_sales: number; credit_sales: number;
  khata_cash_received: number; khata_upi_received: number; cash_refunds: number; supplier_cash_paid: number;
}
interface Status { session: { id: string; opened_at: string; opening_cash: number }; totals: Totals; expected_cash: number; }
interface Closed {
  id: string; user_id: string; opened_at: string; closed_at: string; opening_cash: number; counted_cash: number;
  expected_cash: number; difference: number; totals: Totals | null; note: string | null;
}

const rupees = (n: unknown) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Register() {
  const { user } = useAuth();
  const { role } = useUserRole();
  const { filterStoreId } = useStore();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [opening, setOpening] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Closed[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [justClosed, setJustClosed] = useState<Closed | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("register_status" as any);
    if (error) {
      if (error.code === "PGRST202") setUnavailable(true);
      setLoading(false);
      return;
    }
    setUnavailable(false);
    setStatus((data as any) || null);
    const { data: hist } = await inStore(
      supabase.from("register_sessions" as any).select("*").not("closed_at", "is", null),
      role === "cashier" ? null : filterStoreId
    ).order("closed_at", { ascending: false }).limit(30);
    setHistory((hist || []) as any);
    const { data: profiles } = await supabase.from("profiles").select("user_id, full_name");
    setNames(Object.fromEntries(((profiles || []) as any[]).map((p) => [p.user_id, p.full_name || "Staff"])));
    setLoading(false);
  };

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, filterStoreId, role]);

  const openRegister = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("open_register" as any, { p_opening_cash: parseFloat(opening) || 0 } as any);
    setBusy(false);
    if (error) { toast({ title: "Not opened", description: error.message, variant: "destructive" }); return; }
    setOpening("");
    setJustClosed(null);
    toast({ title: "Register opened" });
    load();
  };

  const closeRegister = async () => {
    if (counted.trim() === "") { toast({ title: "Count the cash in the drawer first", variant: "destructive" }); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("close_register" as any, { p_counted_cash: parseFloat(counted) || 0, p_note: note.trim() || null } as any);
    setBusy(false);
    if (error) { toast({ title: "Not closed", description: error.message, variant: "destructive" }); return; }
    setCounted(""); setNote("");
    setJustClosed(data as any);
    load();
  };

  const diffBadge = (d: number) => Math.abs(d) < 0.01
    ? <Badge variant="secondary">Matches</Badge>
    : d < 0 ? <Badge variant="destructive">Short {rupees(-d)}</Badge> : <Badge variant="outline">Extra {rupees(d)}</Badge>;

  const t = status?.totals;

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Landmark className="h-6 w-6" /> Day closing</h1>
          <p className="text-muted-foreground">Open the cash drawer at the start of your shift and count it at the end</p>
        </div>

        {unavailable ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">
            Day closing needs a database update. Ask your admin to run the latest dailykart-updates.sql in Supabase.
          </CardContent></Card>
        ) : loading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : !status ? (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><LockOpen className="h-5 w-5" /> Open register</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {justClosed && (
                <div className="rounded-md border p-3 space-y-1">
                  <p className="font-medium">Register closed. {diffBadge(Number(justClosed.difference))}</p>
                  <p className="text-sm text-muted-foreground">Expected {rupees(justClosed.expected_cash)}, counted {rupees(justClosed.counted_cash)}</p>
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                <div className="space-y-2 flex-1">
                  <Label htmlFor="open-cash">Cash in drawer now (opening cash)</Label>
                  <Input id="open-cash" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0" value={opening} onChange={(e) => setOpening(e.target.value)} />
                </div>
                <Button onClick={openRegister} disabled={busy}>Open register</Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Since {new Date(status.session.opened_at).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {([
                  ["Bills", String(t?.bills ?? 0)],
                  ["Total sales", rupees(t?.total_sales)],
                  ["Cash sales", rupees(t?.cash_sales)],
                  ["UPI sales", rupees(t?.upi_sales)],
                  ["Card sales", rupees(t?.card_sales)],
                  ["Udhaar given", rupees(t?.credit_sales)],
                  ["Khata cash received", rupees(t?.khata_cash_received)],
                  ["Khata UPI received", rupees(t?.khata_upi_received)],
                  ["Cash refunds", `- ${rupees(t?.cash_refunds)}`],
                  ["Cash paid to suppliers", `- ${rupees(t?.supplier_cash_paid)}`],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="flex justify-between"><span className="text-muted-foreground">{k}</span><span>{v}</span></div>
                ))}
                <div className="flex justify-between border-t pt-2 mt-2"><span>Opening cash</span><span>{rupees(status.session.opening_cash)}</span></div>
                <div className="flex justify-between font-bold text-base"><span>Cash that should be in drawer</span><span>{rupees(status.expected_cash)}</span></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Lock className="h-5 w-5" /> Close register</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="count-cash">Cash counted in drawer</Label>
                  <Input id="count-cash" type="number" inputMode="decimal" min="0" step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} />
                </div>
                {counted.trim() !== "" && <div>{diffBadge((parseFloat(counted) || 0) - Number(status.expected_cash))}</div>}
                <div className="space-y-2">
                  <Label htmlFor="close-note">Note (optional)</Label>
                  <Input id="close-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. took 2000 to bank" />
                </div>
                <Button onClick={closeRegister} disabled={busy} className="w-full">Close register</Button>
              </CardContent>
            </Card>
          </div>
        )}

        {!unavailable && history.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-lg">Past closings</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Closed</TableHead>
                    {role !== "cashier" && <TableHead>Staff</TableHead>}
                    <TableHead className="text-right">Sales</TableHead>
                    <TableHead className="text-right">Expected cash</TableHead>
                    <TableHead className="text-right">Counted</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="whitespace-nowrap">{new Date(h.closed_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</TableCell>
                      {role !== "cashier" && <TableCell>{names[h.user_id] || "Staff"}</TableCell>}
                      <TableCell className="text-right">{rupees(h.totals?.total_sales)}</TableCell>
                      <TableCell className="text-right">{rupees(h.expected_cash)}</TableCell>
                      <TableCell className="text-right">{rupees(h.counted_cash)}</TableCell>
                      <TableCell>{diffBadge(Number(h.difference))}{h.note ? <span className="text-xs text-muted-foreground ml-2">{h.note}</span> : null}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
