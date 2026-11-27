import { useEffect, useMemo, useState } from "react";
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
import { toast } from "@/hooks/use-toast";
import { BookOpen, MessageCircle, IndianRupee, Search, ArrowLeft } from "lucide-react";

interface Balance {
  customer_id: string;
  name: string;
  phone: string | null;
  location_id: string;
  credit_total: number;
  paid_total: number;
  balance: number;
  last_activity: string | null;
}

interface LedgerRow {
  id: string;
  at: string;
  kind: "sale" | "payment";
  label: string;
  debit: number;
  credit: number;
  running: number;
}

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Khata() {
  const { filterStoreId } = useStore();
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

  const loadLedger = async (customerId: string) => {
    const [salesRes, payRes] = await Promise.all([
      supabase
        .from("sales")
        .select("id, invoice_number, total_amount, created_at, status")
        .eq("customer_id", customerId)
        .eq("payment_method", "credit")
        .order("created_at", { ascending: true }),
      supabase
        .from("customer_payments" as any)
        .select("id, amount, method, note, created_at")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: true }),
    ]);
    const entries = [
      ...((salesRes.data || []) as any[])
        .filter((s) => (s.status || "completed") !== "cancelled")
        .map((s) => ({ id: s.id, at: s.created_at, kind: "sale" as const, label: `Bill ${s.invoice_number}`, debit: Number(s.total_amount), credit: 0 })),
      ...((payRes.data || []) as any[]).map((p) => ({
        id: p.id, at: p.created_at, kind: "payment" as const,
        label: `Paid by ${String(p.method).toUpperCase()}${p.note ? ` (${p.note})` : ""}`, debit: 0, credit: Number(p.amount),
      })),
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    let running = 0;
    setLedger(entries.map((e) => { running += e.debit - e.credit; return { ...e, running: Math.round(running * 100) / 100 }; }).reverse());
  };

  const openCustomer = (b: Balance) => {
    setSelected(b);
    setAmount(b.balance > 0 ? String(b.balance) : "");
    setNote("");
    setMethod("cash");
    loadLedger(b.customer_id);
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
      await loadLedger(selected.customer_id);
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
    const msg = `Namaste ${b.name} ji,\n\nYour pending amount at our shop is ${rupees(b.balance)}.\nPlease pay at your convenience (cash or UPI).\n\nThank you!`;
    window.open(`https://wa.me/${to}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return balances
      .filter((b) => showSettled || Math.abs(b.balance) >= 0.01)
      .filter((b) => !q || b.name.toLowerCase().includes(q) || (b.phone || "").includes(q));
  }, [balances, search, showSettled]);

  const totalDue = balances.reduce((s, b) => s + Math.max(0, b.balance), 0);
  const peopleOwing = balances.filter((b) => b.balance >= 0.01).length;

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6" /> Khata (Udhaar)</h1>
          <p className="text-muted-foreground">Credit given to customers and payments received</p>
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledger.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No entries yet</TableCell></TableRow>
                    ) : ledger.map((r) => (
                      <TableRow key={`${r.kind}-${r.id}`}>
                        <TableCell className="whitespace-nowrap">{new Date(r.at).toLocaleDateString("en-IN")}</TableCell>
                        <TableCell>{r.label}</TableCell>
                        <TableCell className="text-right">{r.debit ? rupees(r.debit) : ""}</TableCell>
                        <TableCell className="text-right text-green-600">{r.credit ? rupees(r.credit) : ""}</TableCell>
                        <TableCell className="text-right font-medium">{rupees(r.running)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Total to collect</p><p className="text-3xl font-bold text-destructive">{rupees(totalDue)}</p></CardContent></Card>
              <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Customers with dues</p><p className="text-3xl font-bold">{peopleOwing}</p></CardContent></Card>
            </div>
            <Card>
              <CardHeader className="space-y-3">
                <CardTitle className="text-lg">Customers</CardTitle>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input className="pl-10" placeholder="Search name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
                  </div>
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
                            <div className="text-xs text-muted-foreground">{b.phone || "No phone"}</div>
                          </TableCell>
                          <TableCell className="text-right">
                            {b.balance > 0 ? <span className="font-semibold text-destructive">{rupees(b.balance)}</span>
                              : b.balance < 0 ? <Badge variant="outline">Advance {rupees(-b.balance)}</Badge>
                              : <Badge variant="secondary">Settled</Badge>}
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
