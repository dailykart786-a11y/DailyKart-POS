import { useEffect, useMemo, useRef, useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useStore, inStore } from "@/hooks/useStore";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "@/hooks/use-toast";
import { customerLedger, withRunning, dueInfo, printStatement, type LedgerRow } from "@/lib/statement";
import { istToday } from "@/lib/dailySummary";
import { BookOpen, MessageCircle, IndianRupee, Search, ArrowLeft, Printer, Undo2, Settings2, Download } from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

interface Balance {
  customer_id: string;
  name: string;
  phone: string | null;
  location_id: string;
  credit_total: number;
  paid_total: number;
  balance: number;
  last_activity: string | null;
  // newer database only
  opening_balance?: number;
  credit_limit?: number | null;
  credit_days?: number | null;
  customer_group?: string | null;
  oldest_due_at?: string | null;
}

const monthStart = () => `${istToday().slice(0, 8)}01`;
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Khata() {
  const { filterStoreId, stores, workingStoreId } = useStore();
  const { role } = useUserRole();
  const canManage = role === "admin" || role === "manager" || role === "accountant";
  const [group, setGroup] = useState("all");
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(istToday());
  const [reversing, setReversing] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [showTerms, setShowTerms] = useState(false);
  const [tOpening, setTOpening] = useState("");
  const [tLimit, setTLimit] = useState("");
  const [tDays, setTDays] = useState("");
  const [tGroup, setTGroup] = useState("");
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [search, setSearch] = useState("");
  const [showSettled, setShowSettled] = useState(false);
  const [selected, setSelected] = useState<Balance | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const statementRef = useRef<HTMLDivElement>(null);

  const loadBalances = async () => {
    setLoading(true);
    try {
      const { data, error } = await inStore(
        supabase.from("customer_balances" as any).select("*"),
        filterStoreId
      ).order("balance", { ascending: false });
      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205" || /customer_balances/.test(error.message)) {
          setUnavailable(true);
          return;
        }
        throw error;
      }
      setUnavailable(false);
      const rows = ((data || []) as any[]).map((r) => ({
        ...r,
        credit_total: Number(r.credit_total),
        paid_total: Number(r.paid_total),
        balance: Number(r.balance),
        opening_balance: Number(r.opening_balance || 0),
        credit_limit: r.credit_limit == null ? null : Number(r.credit_limit),
      })) as Balance[];
      setBalances(rows);
      if (selected) setSelected(rows.find((r) => r.customer_id === selected.customer_id) || null);
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "Failed to load khata", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStoreId]);

  const [entries, setEntries] = useState<Awaited<ReturnType<typeof customerLedger>>>([]);
  const loadLedger = async (customerId: string, opening = 0) => {
    const list = await customerLedger(customerId, opening);
    setEntries(list);
    setLedger(withRunning(list).reverse());
  };

  const openCustomer = (b: Balance) => {
    setSelected(b);
    setAmount(b.balance > 0 ? String(b.balance) : "");
    setNote("");
    setMethod("cash");
    setShowTerms(false);
    setReversing(null);
    loadLedger(b.customer_id, b.opening_balance || 0);
  };

  const openTerms = () => {
    if (!selected) return;
    setTOpening(selected.opening_balance ? String(selected.opening_balance) : "");
    setTLimit(selected.credit_limit != null ? String(selected.credit_limit) : "");
    setTDays(selected.credit_days != null ? String(selected.credit_days) : "");
    setTGroup(selected.customer_group || "");
    setShowTerms(true);
  };

  const saveTerms = async () => {
    if (!selected) return;
    const opening = Math.round((Number(tOpening) || 0) * 100) / 100;
    const limit = numOrNull(tLimit);
    const days = numOrNull(tDays);
    if ((limit != null && (isNaN(limit) || limit < 0)) || (days != null && (isNaN(days) || days < 0 || days > 365 || !Number.isInteger(days)))) {
      toast({ title: "Check the numbers", description: "Limit can't be negative; credit days are 0 to 365", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("customers").update({
      opening_balance: opening, credit_limit: limit, credit_days: days, customer_group: tGroup.trim() || null,
    } as any).eq("id", selected.customer_id);
    setSaving(false);
    if (error) {
      toast({ title: "Not saved", description: /opening_balance|credit_limit|column/.test(error.message || "") ? "Ask your admin to run the latest dailykart-updates.sql first" : error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Saved", description: `Udhaar settings for ${selected.name}` });
    setShowTerms(false);
    await loadBalances();
    await loadLedger(selected.customer_id, opening);
  };

  const reversePayment = async (paymentId: string) => {
    if (!selected) return;
    if (!reverseReason.trim()) { toast({ title: "Write why it is being reversed", variant: "destructive" }); return; }
    setSaving(true);
    const { error } = await supabase.rpc("reverse_customer_payment" as any, { p_payment_id: paymentId, p_reason: reverseReason.trim() } as any);
    setSaving(false);
    if (error) {
      toast({ title: "Not reversed", description: error.code === "PGRST202" ? "Ask your admin to run the latest dailykart-updates.sql first" : error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Payment reversed", description: "The original entry stays in the ledger, crossed out" });
    setReversing(null);
    setReverseReason("");
    await loadBalances();
    await loadLedger(selected.customer_id, selected.opening_balance || 0);
  };

  const shopName = stores.find((st) => st.id === (selected?.location_id || workingStoreId))?.name || "DailyKart";
  const printIt = () => {
    if (!selected) return;
    if (from > to) { toast({ title: "The start date is after the end date", variant: "destructive" }); return; }
    const ok = printStatement({
      shop: shopName, party: selected.name, phone: selected.phone, from, to, entries,
      debitLabel: "Udhaar", creditLabel: "Paid", owedLabel: "Amount due",
    });
    if (!ok) toast({ title: "Allow pop-ups to print", description: "Your browser blocked the print window", variant: "destructive" });
  };

  const recordPayment = async () => {
    if (!selected) return;
    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (!amt || amt <= 0) {
      toast({ title: "Enter the amount received", variant: "destructive" });
      return;
    }
    if (amt > selected.balance + 0.001 && !window.confirm(`${rupees(amt)} is more than the ${rupees(selected.balance)} due. Save anyway as advance?`)) {
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("customer_payments" as any)
        .insert({ customer_id: selected.customer_id, amount: amt, method, note: note.trim() || null } as any);
      if (error) throw error;
      toast({ title: "Payment saved", description: `${rupees(amt)} received from ${selected.name}` });
      setNote("");
      await loadBalances();
      await loadLedger(selected.customer_id, selected.opening_balance || 0);
      setAmount("");
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message || "Failed to save payment", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const sendReminder = (b: Balance) => {
    const phone = (b.phone || "").replace(/\D/g, "");
    if (!phone) {
      toast({ title: "No phone number", description: "Add the customer's phone number on the Customers page", variant: "destructive" });
      return;
    }
    const to = phone.length === 10 ? `91${phone}` : phone;
    const msg = `Hello ${b.name},\n\nYour pending amount at our shop is ${rupees(b.balance)}.\nPlease pay at your convenience (cash or UPI).\n\nThank you!`;
    window.open(`https://wa.me/${to}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  /** Generates a PDF image of the customer's statement/ledger so it can be
   *  downloaded and attached to a WhatsApp message manually. WhatsApp's free
   *  web link only supports text, so the image must be attached separately. */
  const downloadStatementImage = async () => {
    if (!statementRef.current || !selected) return;
    try {
      const canvas = await html2canvas(statementRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
      const fileName = `statement-${selected.name.replace(/\s+/g, "_")}-${selected.balance}.pdf`;
      pdf.save(fileName);
      toast({ title: "Statement saved", description: "Open WhatsApp and attach this PDF to your message." });
    } catch (e: any) {
      toast({ title: "Could not save statement", description: e?.message || "Try again", variant: "destructive" });
    }
  };

  const overdueOf = (b: Balance) => (b.balance > 0 ? dueInfo(b.oldest_due_at, b.credit_days) : null);
  const groups = useMemo(() => Array.from(new Set(balances.map((b) => b.customer_group).filter(Boolean) as string[])).sort(), [balances]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return balances
      .filter((b) => showSettled || Math.abs(b.balance) >= 0.01)
      .filter((b) => group === "all" || (b.customer_group || "") === group)
      .filter((b) => !onlyOverdue || (overdueOf(b)?.overdueDays ?? -1) > 0)
      .filter((b) => !q || b.name.toLowerCase().includes(q) || (b.phone || "").includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balances, search, showSettled, group, onlyOverdue]);
  const overdueCount = balances.filter((b) => (overdueOf(b)?.overdueDays ?? -1) > 0).length;

  const totalDue = balances.reduce((s, b) => s + Math.max(0, b.balance), 0);
  const peopleOwing = balances.filter((b) => b.balance >= 0.01).length;

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6" /> Khata (Udhaar)</h1>
          <p className="text-muted-foreground">Credit given to customers and payments received. To set an opening balance or limit for someone with no dues, tap "Show settled too" and open them.</p>
        </div>

        {unavailable ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Khata needs a database update. Ask your admin to run the latest dailykart-updates.sql in Supabase.
            </CardContent>
          </Card>
        ) : selected ? (
          <div className="space-y-4">
            <Button variant="ghost" className="gap-2" onClick={() => setSelected(null)}>
              <ArrowLeft className="h-4 w-4" /> All customers
            </Button>
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardContent className="p-5">
                  <p className="text-sm text-muted-foreground">{selected.name}{selected.phone ? ` · ${selected.phone}` : ""}</p>
                  <p className={`text-3xl font-bold ${selected.balance > 0 ? "text-destructive" : "text-green-600"}`}>{rupees(selected.balance)}</p>
                  <p className="text-sm text-muted-foreground">{selected.balance > 0 ? "due" : selected.balance < 0 ? "advance paid" : "settled"}</p>
                  <div className="mt-2 space-y-1 text-sm">
                    {selected.customer_group && <Badge variant="outline">{selected.customer_group}</Badge>}
                    {selected.credit_limit != null && (
                      <p className={selected.balance > selected.credit_limit ? "text-destructive font-medium" : "text-muted-foreground"}>
                        Limit {rupees(selected.credit_limit)}{selected.balance > selected.credit_limit ? " (crossed)" : ` · ${rupees(Math.max(0, selected.credit_limit - selected.balance))} left`}
                      </p>
                    )}
                    {(() => {
                      const d = overdueOf(selected);
                      if (!d) return selected.credit_days != null ? <p className="text-muted-foreground">Pay within {selected.credit_days} days</p> : null;
                      return <p className={d.overdueDays > 0 ? "text-destructive font-medium" : "text-muted-foreground"}>
                        {d.overdueDays > 0 ? `Overdue by ${d.overdueDays} day${d.overdueDays === 1 ? "" : "s"}` : `Due by ${d.due.toLocaleDateString("en-IN")}`}
                      </p>;
                    })()}
                  </div>
                  {canManage && (
                    <Button variant="ghost" size="sm" className="mt-2 gap-2 px-0" onClick={openTerms}>
                      <Settings2 className="h-4 w-4" /> Limit, due days, opening balance
                    </Button>
                  )}
                  {selected.balance > 0 && (
                    <Button variant="outline" className="mt-3 gap-2 w-full" onClick={() => sendReminder(selected)}>
                      <MessageCircle className="h-4 w-4" /> WhatsApp reminder
                    </Button>
                  )}
                </CardContent>
              </Card>
              <Card className="md:col-span-2">
                <CardHeader><CardTitle className="text-lg">Record payment received</CardTitle></CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-[1fr_140px] items-end">
                  <div className="space-y-2">
                    <Label htmlFor="pay-amount">Amount</Label>
                    <Input id="pay-amount" type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Paid by</Label>
                    <Select value={method} onValueChange={setMethod}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="upi">UPI</SelectItem>
                        <SelectItem value="card">Card</SelectItem>
                        <SelectItem value="bank">Bank transfer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="pay-note">Note (optional)</Label>
                    <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. part payment" />
                  </div>
                  <Button onClick={recordPayment} disabled={saving} className="gap-2 sm:col-span-2">
                    <IndianRupee className="h-4 w-4" /> {saving ? "Saving..." : "Save payment"}
                  </Button>
                </CardContent>
              </Card>
            </div>
            {showTerms && (
              <Card>
                <CardHeader><CardTitle className="text-lg">Udhaar settings for {selected.name}</CardTitle></CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
                  <div className="space-y-2">
                    <Label htmlFor="t-opening">Opening balance (₹)</Label>
                    <Input id="t-opening" type="number" step="0.01" value={tOpening} onChange={(e) => setTOpening(e.target.value)} placeholder="0" />
                    <p className="text-xs text-muted-foreground">Old dues from before DailyKart. Minus means advance.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="t-limit">Credit limit (₹)</Label>
                    <Input id="t-limit" type="number" min="0" step="1" value={tLimit} onChange={(e) => setTLimit(e.target.value)} placeholder="No limit" />
                    <p className="text-xs text-muted-foreground">Cashiers can't bill udhaar past this.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="t-days">Credit days</Label>
                    <Input id="t-days" type="number" min="0" max="365" step="1" value={tDays} onChange={(e) => setTDays(e.target.value)} placeholder="No due date" />
                    <p className="text-xs text-muted-foreground">Days to pay after each udhaar bill.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="t-group">Customer group</Label>
                    <Input id="t-group" list="khata-groups" value={tGroup} onChange={(e) => setTGroup(e.target.value)} placeholder="e.g. Regular, Wholesale" />
                    <datalist id="khata-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
                    <p className="text-xs text-muted-foreground">&nbsp;</p>
                  </div>
                  <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
                    <Button onClick={saveTerms} disabled={saving}>Save</Button>
                    <Button variant="outline" onClick={() => setShowTerms(false)}>Cancel</Button>
                  </div>
                </CardContent>
              </Card>
            )}
            <div ref={statementRef} className="space-y-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle className="text-lg">Statement</CardTitle>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={downloadStatementImage}
                    disabled={!statementRef.current}
                  >
                    <Download className="h-3.5 w-3.5" /> Download image
                  </Button>
                </CardHeader>
                <CardContent className="flex flex-wrap items-end gap-2">
                  <div className="space-y-2">
                    <Label htmlFor="st-from">From</Label>
                    <Input id="st-from" type="date" className="w-44" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="st-to">To</Label>
                    <Input id="st-to" type="date" className="w-44" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
                  </div>
                  <Button variant="outline" className="gap-2" onClick={printIt}><Printer className="h-4 w-4" /> Print statement</Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-lg">Ledger</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Entry</TableHead>
                        <TableHead className="text-right">Udhaar</TableHead>
                        <TableHead className="text-right">Paid</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                        {canManage && <TableHead></TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledger.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No entries yet</TableCell></TableRow>
                      ) : ledger.map((r) => (
                        <TableRow key={`${r.kind}-${r.id}`} className={r.reversed ? "text-muted-foreground" : ""}>
                          <TableCell className="whitespace-nowrap">{r.kind === "opening" ? "Opening" : new Date(r.at).toLocaleDateString("en-IN")}</TableCell>
                          <TableCell>
                            <span className={r.reversed ? "line-through" : ""}>{r.label}</span>
                            {r.reversed && <div className="text-xs">Reversed {new Date(r.reversed.at).toLocaleDateString("en-IN")}{r.reversed.reason ? `: ${r.reversed.reason}` : ""}</div>}
                            {reversing === r.paymentId && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Input className="h-8 w-56" aria-label="Why reverse" placeholder="Why? e.g. entered twice" value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
                                <Button size="sm" variant="destructive" disabled={saving} onClick={() => reversePayment(r.paymentId!)}>Reverse</Button>
                                <Button size="sm" variant="ghost" onClick={() => setReversing(null)}>Cancel</Button>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{r.debit ? rupees(r.debit) : ""}</TableCell>
                          <TableCell className={`text-right ${r.reversed ? "line-through" : "text-green-600"}`}>{r.credit ? rupees(r.credit) : ""}</TableCell>
                          <TableCell className="text-right font-medium">{rupees(r.running)}</TableCell>
                          {canManage && (
                            <TableCell className="text-right">
                              {r.kind === "payment" && !r.reversed && reversing !== r.paymentId && (
                                <Button size="sm" variant="ghost" aria-label="Reverse this payment" title="Reverse a wrong payment" onClick={() => { setReversing(r.paymentId!); setReverseReason(""); }}>
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
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Total to collect</p><p className="text-3xl font-bold text-destructive">{rupees(totalDue)}</p></CardContent></Card>
              <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Customers with dues</p><p className="text-3xl font-bold">{peopleOwing}</p></CardContent></Card>
              <Card className="cursor-pointer" onClick={() => setOnlyOverdue((v) => !v)}><CardContent className="p-5"><p className="text-sm text-muted-foreground">Overdue {onlyOverdue ? "(showing only these)" : ""}</p><p className={`text-3xl font-bold ${overdueCount ? "text-destructive" : ""}`}>{overdueCount}</p></CardContent></Card>
            </div>
            <Card>
              <CardHeader className="space-y-3">
                <CardTitle className="text-lg">Customers</CardTitle>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input className="pl-10" placeholder="Search name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
                  </div>
                  {groups.length > 0 && (
                    <Select value={group} onValueChange={setGroup}>
                      <SelectTrigger className="sm:w-44" aria-label="Customer group"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All groups</SelectItem>
                        {groups.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  <Button variant="outline" onClick={() => setShowSettled((v) => !v)}>
                    {showSettled ? "Hide settled" : "Show settled too"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {loading ? (
                  <p className="text-center py-6 text-muted-foreground">Loading...</p>
                ) : visible.length === 0 ? (
                  <p className="text-center py-6 text-muted-foreground">
                    No dues. Choose "Credit" as the payment method at billing to give udhaar.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead className="text-right">Due</TableHead>
                        <TableHead className="hidden sm:table-cell">Last activity</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible.map((b) => (
                        <TableRow key={b.customer_id} className="cursor-pointer" onClick={() => openCustomer(b)}>
                          <TableCell>
                            <div className="font-medium">{b.name}</div>
                            <div className="text-xs text-muted-foreground">{b.phone || "No phone"}{b.customer_group ? ` · ${b.customer_group}` : ""}</div>
                          </TableCell>
                          <TableCell className="text-right">
                            {b.balance > 0 ? <span className="font-semibold text-destructive">{rupees(b.balance)}</span>
                              : b.balance < 0 ? <Badge variant="outline">Advance {rupees(-b.balance)}</Badge>
                                : <Badge variant="secondary">Settled</Badge>}
                            {(() => { const d = overdueOf(b); return d && d.overdueDays > 0 ? <div><Badge variant="destructive">{d.overdueDays}d overdue</Badge></div> : null; })()}
                            {b.credit_limit != null && b.balance > b.credit_limit && <div className="text-xs text-destructive">over limit</div>}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-muted-foreground">
                            {b.last_activity ? new Date(b.last_activity).toLocaleDateString("en-IN") : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {b.balance > 0 && (
                              <Button size="sm" variant="ghost" aria-label={`WhatsApp reminder to ${b.name}`} onClick={(e) => { e.stopPropagation(); sendReminder(b); }}>
                                <MessageCircle className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
