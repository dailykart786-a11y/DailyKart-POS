import { Fragment, useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useStore, inStore } from "@/hooks/useStore";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { Landmark, LockOpen, Lock, Smartphone, CreditCard, Wallet, ChevronDown, ChevronUp } from "lucide-react";
import { DailySummaryCard } from "@/components/DailySummaryCard";
import { CashCounter } from "@/components/register/CashCounter";
import { CountSummary } from "@/components/register/CountSummary";
import { DiffBadge, MethodCheck, type MethodRow } from "@/components/register/MethodCheck";
import { type CashCount, cleanCount, countPieces, countTotal, emptyCount, rupees } from "@/lib/cashCount";

interface Totals {
  bills: number; total_sales: number; cash_sales: number; upi_sales: number; card_sales: number; credit_sales: number;
  khata_cash_received: number; khata_upi_received: number; cash_refunds: number; supplier_cash_paid: number; expense_cash_paid?: number; bank_sales?: number;
}
interface Breakdown { cash?: CashCount; upi?: number | null; card?: number | null; other?: number | null;
  methods?: Record<string, { expected: number; counted: number | null; difference: number | null }> }
interface Session { id: string; opened_at: string; opening_cash: number; opening_breakdown?: Breakdown | null }
interface Status { session: Session; totals: Totals; expected_cash: number; }
interface Closed {
  id: string; user_id: string; opened_at: string; closed_at: string; opening_cash: number; counted_cash: number;
  expected_cash: number; difference: number; totals: Totals | null; note: string | null;
  opening_breakdown?: Breakdown | null; closing_breakdown?: Breakdown | null;
}

const num = (v: unknown) => Number(v || 0);
const parseAmount = (s: string): number | null => (s.trim() === "" ? null : Math.max(0, parseFloat(s) || 0));
const isMissingFn = (e: { code?: string } | null) => e?.code === "PGRST202";

/** Expected vs counted rows for a closed session (uses the stored breakdown when there is one). */
function closedRows(h: Closed): MethodRow[] {
  const m = h.closing_breakdown?.methods;
  const t = h.totals;
  const row = (key: string, label: string, expected: number, counted: number | null) => ({
    key, label, expected: m?.[key] ? num(m[key].expected) : expected,
    counted: m?.[key] ? (m[key].counted === null ? null : num(m[key].counted)) : counted,
  });
  const rows = [
    row("cash", "Cash in drawer", num(h.expected_cash), num(h.counted_cash)),
    row("upi", "UPI", num(t?.upi_sales) + num(t?.khata_upi_received), null),
    row("card", "Card", num(t?.card_sales), null),
    row("other", "Bank / other", num(t?.bank_sales), null),
  ];
  return rows.filter((r) => r.key === "cash" || r.expected > 0 || r.counted !== null);
}

export default function Register() {
  const { user } = useAuth();
  const { role } = useUserRole();
  const { filterStoreId } = useStore();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [openCount, setOpenCount] = useState<CashCount>(emptyCount);
  const [closeCount, setCloseCount] = useState<CashCount>(emptyCount);
  const [upi, setUpi] = useState("");
  const [card, setCard] = useState("");
  const [other, setOther] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Closed[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [justClosed, setJustClosed] = useState<Closed | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showOpening, setShowOpening] = useState(false);

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
    const total = countTotal(openCount);
    setBusy(true);
    // New function saves the notes and coins too; fall back if the database update isn't run yet.
    let { error } = await supabase.rpc("open_register_v2" as any, { p_opening_cash: total, p_breakdown: { cash: cleanCount(openCount) } } as any);
    if (isMissingFn(error)) ({ error } = await supabase.rpc("open_register" as any, { p_opening_cash: total } as any));
    setBusy(false);
    if (error) { toast({ title: "Not opened", description: error.message, variant: "destructive" }); return; }
    setOpenCount(emptyCount());
    setJustClosed(null);
    toast({ title: "Register opened", description: `Opening cash ${rupees(total)}` });
    load();
  };

  const t = status?.totals;
  const expected = {
    cash: num(status?.expected_cash),
    upi: num(t?.upi_sales) + num(t?.khata_upi_received),
    card: num(t?.card_sales),
    other: num(t?.bank_sales),
  };
  const countedCash = countTotal(closeCount);
  const liveRows: MethodRow[] = [
    { key: "cash", label: "Cash in drawer", expected: expected.cash, counted: countPieces(closeCount) > 0 ? countedCash : null },
    { key: "upi", label: "UPI", expected: expected.upi, counted: parseAmount(upi) },
    { key: "card", label: "Card", expected: expected.card, counted: parseAmount(card) },
    { key: "other", label: "Bank / other", expected: expected.other, counted: parseAmount(other) },
  ];

  const closeRegister = async () => {
    if (countPieces(closeCount) === 0 && expected.cash > 0) {
      toast({ title: "Count the cash in the drawer first", description: "Enter how many of each note and coin you have.", variant: "destructive" });
      return;
    }
    setBusy(true);
    const breakdown = { cash: cleanCount(closeCount), upi: parseAmount(upi), card: parseAmount(card), other: parseAmount(other) };
    let { data, error } = await supabase.rpc("close_register_v2" as any, { p_counted_cash: countedCash, p_note: note.trim() || null, p_breakdown: breakdown } as any);
    if (isMissingFn(error)) {
      ({ data, error } = await supabase.rpc("close_register" as any, { p_counted_cash: countedCash, p_note: note.trim() || null } as any));
    }
    setBusy(false);
    if (error) { toast({ title: "Not closed", description: error.message, variant: "destructive" }); return; }
    setCloseCount(emptyCount()); setUpi(""); setCard(""); setOther(""); setNote("");
    setJustClosed(data as any);
    load();
  };

  const onlineInput = (id: string, label: string, hint: string, Icon: typeof Smartphone, value: string, set: (v: string) => void, exp: number) => (
    <div className="space-y-1">
      <Label htmlFor={id} className="flex items-center gap-1.5"><Icon className="h-4 w-4" /> {label}</Label>
      <Input id={id} type="number" inputMode="decimal" min="0" step="0.01" placeholder={`Bills say ${rupees(exp)}`} value={value} onChange={(e) => set(e.target.value)} />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Landmark className="h-6 w-6" /> Day closing</h1>
          <p className="text-muted-foreground">Count notes and coins when your shift starts and ends, and match UPI and card payments with the bills</p>
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
            <CardContent className="space-y-4">
              {justClosed && (
                <div className="rounded-md border p-3 space-y-2">
                  <p className="font-medium flex flex-wrap items-center gap-2">Register closed. <DiffBadge d={Number(justClosed.difference)} /></p>
                  <MethodCheck rows={closedRows(justClosed)} />
                </div>
              )}
              <p className="text-sm text-muted-foreground">Count the cash in the drawer before your first bill. Enter how many of each note and coin you have.</p>
              <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-sm">
                <Smartphone className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <p><span className="font-medium">UPI, card and other online payments</span> are entered when you close the register. Open the register first; at closing you'll see what the bills say you should have received online and type in what actually reached you.</p>
              </div>
              <CashCounter idPrefix="open" value={openCount} onChange={setOpenCount} />
              <Button onClick={openRegister} disabled={busy} className="w-full sm:w-auto">
                Open register with {rupees(countTotal(openCount))}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Card className="h-fit">
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
                  ...(t?.bank_sales ? [["Bank transfer sales", rupees(t.bank_sales)]] : []),
                  ["Udhaar given", rupees(t?.credit_sales)],
                  ["Khata cash received", rupees(t?.khata_cash_received)],
                  ["Khata UPI received", rupees(t?.khata_upi_received)],
                  ["Cash refunds", `- ${rupees(t?.cash_refunds)}`],
                  ["Cash paid to suppliers", `- ${rupees(t?.supplier_cash_paid)}`],
                  ...(t?.expense_cash_paid ? [["Expenses paid from till", `- ${rupees(t.expense_cash_paid)}`]] : []),
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="flex justify-between"><span className="text-muted-foreground">{k}</span><span className="tabular-nums">{v}</span></div>
                ))}
                <div className="flex justify-between border-t pt-2 mt-2">
                  <span>Opening cash</span>
                  <span className="tabular-nums">{rupees(status.session.opening_cash)}</span>
                </div>
                {status.session.opening_breakdown?.cash && (
                  <div>
                    <button type="button" className="text-xs text-primary inline-flex items-center gap-1" onClick={() => setShowOpening((v) => !v)}>
                      {showOpening ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} Opening notes and coins
                    </button>
                    {showOpening && <div className="mt-1"><CountSummary count={status.session.opening_breakdown.cash} /></div>}
                  </div>
                )}
                <div className="flex justify-between font-bold text-base"><span>Cash that should be in drawer</span><span className="tabular-nums">{rupees(expected.cash)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">UPI that should have come in</span><span className="tabular-nums">{rupees(expected.upi)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Card that should have come in</span><span className="tabular-nums">{rupees(expected.card)}</span></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Lock className="h-5 w-5" /> Close register</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                <section className="space-y-2">
                  <h3 className="font-semibold flex items-center gap-2"><Wallet className="h-4 w-4" /> 1. Count the cash drawer</h3>
                  <CashCounter idPrefix="close" value={closeCount} onChange={setCloseCount} />
                </section>
                <section className="space-y-2">
                  <h3 className="font-semibold flex items-center gap-2"><Smartphone className="h-4 w-4" /> 2. Check online payments</h3>
                  <p className="text-xs text-muted-foreground">Enter what actually reached you. Leave blank to skip a check.</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {onlineInput("count-upi", "UPI received", "From your UPI / PhonePe / Paytm / GPay business app", Smartphone, upi, setUpi, expected.upi)}
                    {onlineInput("count-card", "Card received", "From the card machine's settlement slip", CreditCard, card, setCard, expected.card)}
                    {onlineInput("count-other", "Bank / other", "Bank transfers and anything else", Landmark, other, setOther, expected.other)}
                  </div>
                </section>
                <section className="space-y-2">
                  <h3 className="font-semibold">3. Expected vs counted</h3>
                  <MethodCheck rows={liveRows} />
                </section>
                <div className="space-y-2">
                  <Label htmlFor="close-note">Note (optional)</Label>
                  <Input id="close-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. took 2000 to bank" />
                </div>
                <Button onClick={closeRegister} disabled={busy} className="w-full">Close register</Button>
              </CardContent>
            </Card>
          </div>
        )}

        {(role === "manager" || role === "admin") && <DailySummaryCard />}

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
                    <TableHead>Cash</TableHead>
                    <TableHead>UPI / card</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((h) => {
                    const rows = closedRows(h);
                    const online = rows.filter((r) => r.key !== "cash" && r.counted !== null);
                    const onlineDiff = online.reduce((s, r) => s + (num(r.counted) - r.expected), 0);
                    const open = expanded === h.id;
                    return (
                      <Fragment key={h.id}>
                        <TableRow>
                          <TableCell className="whitespace-nowrap">{new Date(h.closed_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</TableCell>
                          {role !== "cashier" && <TableCell>{names[h.user_id] || "Staff"}</TableCell>}
                          <TableCell className="text-right">{rupees(h.totals?.total_sales)}</TableCell>
                          <TableCell className="text-right">{rupees(h.expected_cash)}</TableCell>
                          <TableCell className="text-right">{rupees(h.counted_cash)}</TableCell>
                          <TableCell><DiffBadge d={Number(h.difference)} />{h.note ? <span className="text-xs text-muted-foreground ml-2">{h.note}</span> : null}</TableCell>
                          <TableCell><DiffBadge d={online.length ? onlineDiff : null} /></TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setExpanded(open ? null : h.id)} aria-expanded={open}>
                              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}<span className="sr-only">Details</span>
                            </Button>
                          </TableCell>
                        </TableRow>
                        {open && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={role !== "cashier" ? 8 : 7} className="space-y-3 py-3">
                              <MethodCheck rows={rows} />
                              <div className="grid gap-3 md:grid-cols-2">
                                <div className="space-y-1">
                                  <p className="text-xs font-medium text-muted-foreground">Opening {rupees(h.opening_cash)}</p>
                                  {h.opening_breakdown?.cash ? <CountSummary count={h.opening_breakdown.cash} /> : <p className="text-xs text-muted-foreground">Not counted by notes and coins.</p>}
                                </div>
                                <div className="space-y-1">
                                  <p className="text-xs font-medium text-muted-foreground">Closing {rupees(h.counted_cash)}</p>
                                  {h.closing_breakdown?.cash ? <CountSummary count={h.closing_breakdown.cash} /> : <p className="text-xs text-muted-foreground">Not counted by notes and coins.</p>}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
