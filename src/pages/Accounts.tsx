import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useStore, inStore } from "@/hooks/useStore";
import { toast } from "@/hooks/use-toast";
import { rupees } from "@/lib/statement";
import { BookText, Plus, Trash2, Undo2 } from "lucide-react";

type AccType = "asset" | "liability" | "equity" | "income" | "expense";
interface Account { code: string; name: string; type: AccType; is_system: boolean; }
interface Bal { account_code: string; sub: string | null; name: string; type: AccType; debit: number; credit: number; }
interface BookLine { entry_date: string; source_type: string; source_id: string | null; ref: string | null; sub: string | null; debit: number; credit: number; }
interface Journal { id: string; entry_number: string; entry_date: string; narration: string; reversal_of: string | null; journal_lines?: { account_code: string; sub: string | null; debit: number; credit: number }[]; }
interface JLine { account_code: string; debit: string; credit: string; sub: string; }

const r2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
/** Indian financial year starts on 1 April */
const fyStart = () => {
  const [y, m] = today().split("-").map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
};
const TYPE_LABEL: Record<AccType, string> = { asset: "Asset", liability: "Liability", equity: "Capital", income: "Income", expense: "Expense" };
const SOURCE_LABEL: Record<string, string> = {
  sale: "Bill", return: "Customer return", khata_payment: "Udhaar received", purchase: "Supplier bill",
  supplier_payment: "Paid to supplier", purchase_return: "Debit note", expense: "Expense", opening_balance: "Opening balance",
  journal: "Journal", stock_sale: "Cost of goods sold", stock_return: "Goods back in stock", stock_adjustment: "Stock adjustment",
  stock_opening: "Opening stock", stock_manual: "Stock edited",
};
/** Debit-side accounts (assets, expenses) grow with debits; the rest with credits. */
const natural = (type: AccType, dr: number, cr: number) => (type === "asset" || type === "expense" ? dr - cr : cr - dr);
const BLANK_LINE: JLine = { account_code: "", debit: "", credit: "", sub: "" };

export default function Accounts() {
  const { filterStoreId, workingStoreId, isAdmin } = useStore();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(today());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [period, setPeriod] = useState<Bal[]>([]);
  const [toDate, setToDate] = useState<Bal[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const [acc, p, b] = await Promise.all([
      supabase.from("accounts" as any).select("code, name, type, is_system").order("code"),
      supabase.rpc("account_balances" as any, { p_from: from || null, p_to: to || null, p_location_id: filterStoreId } as any),
      supabase.rpc("account_balances" as any, { p_from: null, p_to: to || null, p_location_id: filterStoreId } as any),
    ]);
    setLoading(false);
    if (acc.error || p.error || b.error) {
      const e = acc.error || p.error || b.error;
      // missing table / function means the database update hasn't been run
      if (e && ["PGRST202", "PGRST205", "42P01", "42883"].includes(e.code || "")) { setAvailable(false); return; }
      toast({ title: "Couldn't load accounts", description: e?.message, variant: "destructive" });
      setAvailable(true);
      return;
    }
    const num = (rows: any[]) => rows.map((r) => ({ ...r, debit: Number(r.debit) || 0, credit: Number(r.credit) || 0 })) as Bal[];
    setAccounts((acc.data || []) as any);
    setPeriod(num((p.data || []) as any[]));
    setToDate(num((b.data || []) as any[]));
    setAvailable(true);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStoreId, from, to]);

  if (available === false) {
    return (
      <Layout>
        <Card><CardContent className="py-10 text-center text-muted-foreground">Accounts need the latest database update (dailykart-updates.sql). Everything else keeps working.</CardContent></Card>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><BookText className="h-6 w-6" /> Accounts</h1>
            <p className="text-sm text-muted-foreground">Books are made automatically from bills, purchases, payments, expenses and stock.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1"><Label htmlFor="acc-from">From</Label><Input id="acc-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="acc-to">To</Label><Input id="acc-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
        </div>
        {isAdmin && !filterStoreId && <p className="text-xs text-muted-foreground">Showing all stores together. Pick a store at the top to see one store's books.</p>}

        <Tabs defaultValue="pl">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="pl">Profit &amp; loss</TabsTrigger>
            <TabsTrigger value="bs">Balance sheet</TabsTrigger>
            <TabsTrigger value="tb">Trial balance</TabsTrigger>
            <TabsTrigger value="books">Cash &amp; bank book</TabsTrigger>
            <TabsTrigger value="jv">Journals</TabsTrigger>
            <TabsTrigger value="coa">Chart of accounts</TabsTrigger>
          </TabsList>
          <TabsContent value="pl"><ProfitLoss rows={period} loading={loading} /></TabsContent>
          <TabsContent value="bs"><BalanceSheet rows={toDate} asOf={to} /></TabsContent>
          <TabsContent value="tb"><TrialBalance rows={period} /></TabsContent>
          <TabsContent value="books"><Books accounts={accounts} from={from} to={to} storeId={filterStoreId} /></TabsContent>
          <TabsContent value="jv"><Journals accounts={accounts} storeId={filterStoreId} postStoreId={workingStoreId} onChanged={load} /></TabsContent>
          <TabsContent value="coa"><ChartOfAccounts accounts={accounts} onChanged={load} /></TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

function Line({ label, amount, bold, indent }: { label: string; amount: number; bold?: boolean; indent?: boolean }) {
  return (
    <div className={`flex justify-between py-1 ${bold ? "font-semibold border-t" : ""} ${indent ? "pl-4 text-sm" : ""}`}>
      <span>{label}</span><span className={amount < 0 ? "text-destructive" : ""}>{rupees(amount)}</span>
    </div>
  );
}

function ProfitLoss({ rows, loading }: { rows: Bal[]; loading: boolean }) {
  const get = (code: string) => rows.filter((r) => r.account_code === code);
  const amt = (code: string) => get(code).reduce((s, r) => s + natural(r.type, r.debit, r.credit), 0);
  const sales = amt("4000");
  const returns = -amt("4100"); // contra-income: debit balance
  const netSales = r2(sales - returns);
  const cogs = amt("5000");
  const gross = r2(netSales - cogs);
  const otherIncome = rows.filter((r) => r.type === "income" && !["4000", "4100"].includes(r.account_code));
  const expenses = rows.filter((r) => r.type === "expense" && r.account_code !== "5000");
  const otherIncomeTotal = otherIncome.reduce((s, r) => s + natural(r.type, r.debit, r.credit), 0);
  const expenseTotal = expenses.reduce((s, r) => s + natural(r.type, r.debit, r.credit), 0);
  const net = r2(gross + otherIncomeTotal - expenseTotal);
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Profit &amp; loss</CardTitle></CardHeader>
      <CardContent className="max-w-xl">
        {loading && rows.length === 0 ? <p className="text-muted-foreground">Loading…</p> : (
          <>
            <Line label="Sales (before GST)" amount={sales} />
            <Line label="Less: customer returns" amount={returns} indent />
            <Line label="Net sales" amount={netSales} bold />
            <Line label="Less: cost of goods sold" amount={cogs} indent />
            <Line label="Gross profit" amount={gross} bold />
            {netSales > 0 && <p className="text-xs text-muted-foreground pb-2">Gross margin {((gross / netSales) * 100).toFixed(1)}%</p>}
            {otherIncome.map((r) => <Line key={r.account_code + (r.sub || "")} label={`Add: ${r.name}`} amount={natural(r.type, r.debit, r.credit)} indent />)}
            {expenses.map((r) => <Line key={r.account_code + (r.sub || "")} label={`Less: ${r.name}`} amount={natural(r.type, r.debit, r.credit)} indent />)}
            <Line label={net >= 0 ? "Net profit" : "Net loss"} amount={net} bold />
            <p className="text-xs text-muted-foreground mt-3">Cost of goods sold uses each product's cost price at the time of sale. Keep cost prices filled in for a correct profit.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BalanceSheet({ rows, asOf }: { rows: Bal[]; asOf: string }) {
  // one line per account (expense categories folded together)
  const byAcc = new Map<string, Bal>();
  rows.forEach((r) => {
    const cur = byAcc.get(r.account_code);
    if (cur) { cur.debit += r.debit; cur.credit += r.credit; } else byAcc.set(r.account_code, { ...r, sub: null, name: r.account_code === "6000" ? "Expenses" : r.name });
  });
  const all = [...byAcc.values()];
  const side = (t: AccType) => all.filter((r) => r.type === t).map((r) => ({ ...r, amount: r2(natural(r.type, r.debit, r.credit)) })).filter((r) => r.amount !== 0);
  const assets = side("asset");
  const liabilities = side("liability");
  const equity = side("equity");
  const profit = r2(all.filter((r) => r.type === "income").reduce((s, r) => s + natural(r.type, r.debit, r.credit), 0)
    - all.filter((r) => r.type === "expense").reduce((s, r) => s + natural(r.type, r.debit, r.credit), 0));
  const tA = r2(assets.reduce((s, r) => s + r.amount, 0));
  const tL = r2(liabilities.reduce((s, r) => s + r.amount, 0));
  const tE = r2(equity.reduce((s, r) => s + r.amount, 0) + profit);
  const ok = Math.abs(tA - tL - tE) < 0.01;
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg flex flex-wrap items-center gap-2">Balance sheet as on {asOf ? new Date(asOf).toLocaleDateString("en-IN") : "today"}
        <Badge variant={ok ? "secondary" : "destructive"}>{ok ? "Balanced" : "Not balanced"}</Badge></CardTitle></CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="font-semibold mb-1">What the shop owns</h3>
          {assets.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet</p>}
          {assets.map((r) => <Line key={r.account_code} label={r.name} amount={r.amount} indent />)}
          <Line label="Total" amount={tA} bold />
          <p className="text-xs text-muted-foreground mt-2">A negative cash or stock line usually means an opening amount was never entered. Add it as a journal against Owner's capital.</p>
        </div>
        <div>
          <h3 className="font-semibold mb-1">What the shop owes</h3>
          {liabilities.map((r) => <Line key={r.account_code} label={r.name} amount={r.amount} indent />)}
          <Line label="Total owed" amount={tL} bold />
          <h3 className="font-semibold mt-4 mb-1">Owner's share</h3>
          {equity.map((r) => <Line key={r.account_code} label={r.name} amount={r.amount} indent />)}
          <Line label={profit >= 0 ? "Profit so far" : "Loss so far"} amount={profit} indent />
          <Line label="Total owed + owner's share" amount={r2(tL + tE)} bold />
        </div>
      </CardContent>
    </Card>
  );
}

function TrialBalance({ rows }: { rows: Bal[] }) {
  const tD = r2(rows.reduce((s, r) => s + r.debit, 0));
  const tC = r2(rows.reduce((s, r) => s + r.credit, 0));
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg flex items-center gap-2">Trial balance
        <Badge variant={Math.abs(tD - tC) < 0.01 ? "secondary" : "destructive"}>{Math.abs(tD - tC) < 0.01 ? "Debits = credits" : "Mismatch"}</Badge></CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length === 0 ? <p className="text-center text-muted-foreground py-4">No entries in these dates</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Account</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.account_code + (r.sub || "")}>
                  <TableCell className="font-mono text-xs">{r.account_code}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="text-xs">{TYPE_LABEL[r.type] || r.type}</TableCell>
                  <TableCell className="text-right">{r.debit ? rupees(r.debit) : ""}</TableCell>
                  <TableCell className="text-right">{r.credit ? rupees(r.credit) : ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter><TableRow><TableCell colSpan={3} className="font-semibold">Total</TableCell><TableCell className="text-right font-semibold">{rupees(tD)}</TableCell><TableCell className="text-right font-semibold">{rupees(tC)}</TableCell></TableRow></TableFooter>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function Books({ accounts, from, to, storeId }: { accounts: Account[]; from: string; to: string; storeId: string | null }) {
  const [code, setCode] = useState("1000");
  const [lines, setLines] = useState<BookLine[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      setBusy(true);
      const { data, error } = await supabase.rpc("account_ledger" as any, { p_account_code: code, p_from: from || null, p_to: to || null, p_location_id: storeId, p_limit: 1000 } as any);
      if (!live) return;
      setBusy(false);
      if (error) { toast({ title: "Couldn't load book", description: error.message, variant: "destructive" }); return; }
      setLines(((data || []) as any[]).map((l) => ({ ...l, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })));
    })();
    return () => { live = false; };
  }, [code, from, to, storeId]);

  const inTotal = r2(lines.reduce((s, l) => s + l.debit, 0));
  const outTotal = r2(lines.reduce((s, l) => s + l.credit, 0));
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-lg">Account book</CardTitle>
        <Select value={code} onValueChange={setCode}>
          <SelectTrigger className="w-64" aria-label="Book account"><SelectValue /></SelectTrigger>
          <SelectContent>{accounts.map((a) => <SelectItem key={a.code} value={a.code}>{a.code} {a.name}</SelectItem>)}</SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-3 text-sm">
          <div className="rounded border p-2">Debit (in) <div className="font-semibold">{rupees(inTotal)}</div></div>
          <div className="rounded border p-2">Credit (out) <div className="font-semibold">{rupees(outTotal)}</div></div>
          <div className="rounded border p-2">Net for these dates <div className="font-semibold">{rupees(r2(inTotal - outTotal))}</div></div>
        </div>
        <div className="overflow-x-auto">
          {busy && lines.length === 0 ? <p className="text-muted-foreground">Loading…</p> : lines.length === 0 ? <p className="text-center text-muted-foreground py-4">No entries in these dates</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>What</TableHead><TableHead>Ref</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow></TableHeader>
              <TableBody>
                {lines.map((l, i) => (
                  <TableRow key={`${l.source_type}-${l.source_id}-${i}`}>
                    <TableCell className="text-sm whitespace-nowrap">{new Date(l.entry_date).toLocaleDateString("en-IN")}</TableCell>
                    <TableCell className="text-sm">{SOURCE_LABEL[l.source_type] || l.source_type}{l.sub ? ` · ${l.sub}` : ""}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.ref || ""}</TableCell>
                    <TableCell className="text-right">{l.debit ? rupees(l.debit) : ""}</TableCell>
                    <TableCell className="text-right">{l.credit ? rupees(l.credit) : ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {lines.length >= 1000 && <p className="text-xs text-muted-foreground mt-2">Showing the latest 1,000 lines. Narrow the dates to see older ones.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function Journals({ accounts, storeId, postStoreId, onChanged }: { accounts: Account[]; storeId: string | null; postStoreId: string | null; onChanged: () => void }) {
  const [list, setList] = useState<Journal[]>([]);
  const [date, setDate] = useState(today());
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<JLine[]>([{ ...BLANK_LINE }, { ...BLANK_LINE }]);
  const [busy, setBusy] = useState(false);
  const name = (code: string) => accounts.find((a) => a.code === code)?.name || code;

  const load = async () => {
    const { data, error } = await inStore(
      supabase.from("journal_entries" as any).select("id, entry_number, entry_date, narration, reversal_of, location_id, journal_lines(account_code, sub, debit, credit)"),
      storeId,
    ).order("created_at", { ascending: false }).limit(50);
    if (!error) setList((data || []) as any);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const tD = r2(lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0));
  const tC = r2(lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0));
  const setL = (i: number, patch: Partial<JLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const reversed = useMemo(() => new Set(list.map((j) => j.reversal_of).filter(Boolean) as string[]), [list]);

  const save = async () => {
    const used = lines.filter((l) => l.account_code && ((parseFloat(l.debit) || 0) > 0 || (parseFloat(l.credit) || 0) > 0));
    if (!narration.trim()) { toast({ title: "Write what this entry is for", variant: "destructive" }); return; }
    if (used.length < 2) { toast({ title: "Fill at least two lines", variant: "destructive" }); return; }
    if (used.some((l) => (parseFloat(l.debit) || 0) > 0 && (parseFloat(l.credit) || 0) > 0)) { toast({ title: "Each line is either debit or credit", variant: "destructive" }); return; }
    if (tD !== tC) { toast({ title: "Debits and credits must be equal", description: `${rupees(tD)} vs ${rupees(tC)}`, variant: "destructive" }); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("post_journal" as any, {
      p_date: date, p_narration: narration.trim(), p_location_id: postStoreId,
      p_lines: used.map((l) => ({ account_code: l.account_code, debit: parseFloat(l.debit) || 0, credit: parseFloat(l.credit) || 0, sub: l.sub.trim() || null })),
    } as any);
    setBusy(false);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Journal ${(data as any)?.entry_number || ""} saved` });
    setNarration(""); setLines([{ ...BLANK_LINE }, { ...BLANK_LINE }]);
    load(); onChanged();
  };

  const reverse = async (j: Journal) => {
    const reason = window.prompt(`Why reverse ${j.entry_number}? (optional)`) ;
    if (reason === null) return;
    const { error } = await supabase.rpc("reverse_journal" as any, { p_entry_id: j.id, p_reason: reason || null } as any);
    if (error) { toast({ title: "Not reversed", description: error.message, variant: "destructive" }); return; }
    toast({ title: `${j.entry_number} reversed` });
    load(); onChanged();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-lg">New journal entry</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">For money that doesn't come from a bill: owner putting in or taking out cash, a loan, opening cash and stock, a deposit, bank charges.</p>
          <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
            <div className="space-y-1"><Label htmlFor="jv-date">Date</Label><Input id="jv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="jv-narration">What is it for</Label><Input id="jv-narration" placeholder="e.g. Owner put ₹50,000 in the bank" value={narration} onChange={(e) => setNarration(e.target.value)} /></div>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid gap-2 grid-cols-2 sm:grid-cols-[1fr_120px_120px_140px_40px] items-center">
                <Select value={l.account_code} onValueChange={(v) => setL(i, { account_code: v })}>
                  <SelectTrigger aria-label={`Line ${i + 1} account`} className="col-span-2 sm:col-span-1"><SelectValue placeholder="Account" /></SelectTrigger>
                  <SelectContent>{accounts.map((a) => <SelectItem key={a.code} value={a.code}>{a.code} {a.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" min="0" step="0.01" placeholder="Debit" aria-label={`Line ${i + 1} debit`} value={l.debit} onChange={(e) => setL(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} />
                <Input type="number" min="0" step="0.01" placeholder="Credit" aria-label={`Line ${i + 1} credit`} value={l.credit} onChange={(e) => setL(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} />
                <Input placeholder={l.account_code === "6000" ? "Category" : "Note (optional)"} aria-label={`Line ${i + 1} note`} value={l.sub} onChange={(e) => setL(i, { sub: e.target.value })} />
                <Button size="icon" variant="ghost" aria-label={`Remove line ${i + 1}`} disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setLines((ls) => [...ls, { ...BLANK_LINE }])}><Plus className="h-4 w-4" /> Add line</Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <span className={`text-sm ${tD === tC && tD > 0 ? "" : "text-destructive"}`}>Debit {rupees(tD)} · Credit {rupees(tC)}{tD !== tC ? ` · difference ${rupees(Math.abs(tD - tC))}` : ""}</span>
            <Button onClick={save} disabled={busy}>Save journal</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Recent journals</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {list.length === 0 ? <p className="text-center text-muted-foreground py-4">No journals yet</p> : list.map((j) => (
            <div key={j.id} className="rounded border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium">{j.entry_number}</span>
                  <span className="text-sm text-muted-foreground"> · {new Date(j.entry_date).toLocaleDateString("en-IN")} · {j.narration}</span>
                  {reversed.has(j.id) && <Badge variant="outline" className="ml-2">Reversed</Badge>}
                </div>
                {!j.reversal_of && !reversed.has(j.id) && (
                  <Button size="sm" variant="ghost" className="gap-1" onClick={() => reverse(j)}><Undo2 className="h-4 w-4" /> Reverse</Button>
                )}
              </div>
              <div className="mt-2 text-sm">
                {(j.journal_lines || []).map((l, i) => (
                  <div key={i} className="flex justify-between">
                    <span className={l.credit > 0 ? "pl-6" : ""}>{name(l.account_code)}{l.sub ? ` · ${l.sub}` : ""}</span>
                    <span>{Number(l.debit) > 0 ? `Dr ${rupees(Number(l.debit))}` : `Cr ${rupees(Number(l.credit))}`}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ChartOfAccounts({ accounts, onChanged }: { accounts: Account[]; onChanged: () => void }) {
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<AccType>("expense");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!newName.trim()) { toast({ title: "Give the account a name", variant: "destructive" }); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("add_account" as any, { p_name: newName.trim(), p_type: newType } as any);
    setBusy(false);
    if (error) { toast({ title: "Not added", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Account ${(data as any)?.code || ""} added` });
    setNewName("");
    onChanged();
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Chart of accounts</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1 flex-1 min-w-[180px]"><Label htmlFor="coa-name">New account</Label><Input id="coa-name" placeholder="e.g. Shop loan, Rent deposit" value={newName} onChange={(e) => setNewName(e.target.value)} /></div>
          <div className="space-y-1">
            <Label>Type</Label>
            <Select value={newType} onValueChange={(v) => setNewType(v as AccType)}>
              <SelectTrigger className="w-40" aria-label="New account type"><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(TYPE_LABEL) as AccType[]).map((t) => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={add} disabled={busy} className="gap-1"><Plus className="h-4 w-4" /> Add</Button>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.code}>
                  <TableCell className="font-mono text-xs">{a.code}</TableCell>
                  <TableCell>{a.name}</TableCell>
                  <TableCell className="text-sm">{TYPE_LABEL[a.type] || a.type}</TableCell>
                  <TableCell>{a.is_system && <Badge variant="secondary">Automatic</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
