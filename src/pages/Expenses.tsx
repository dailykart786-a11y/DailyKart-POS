import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore, inStore } from "@/hooks/useStore";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "@/hooks/use-toast";
import { Plus, Calendar, IndianRupee, Check, X, Paperclip, Repeat, Trash2 } from "lucide-react";
import { format } from "date-fns";

interface Expense {
  id: string;
  amount: number;
  category: string;
  description: string | null;
  date: string;
  created_at: string;
  // newer database only
  payment_method?: string;
  paid_from_till?: boolean;
  payee?: string | null;
  receipt_path?: string | null;
  status?: "pending" | "approved" | "rejected";
  recurring_id?: string | null;
}

interface Recurring {
  id: string; category: string; amount: number; payee: string | null; description: string | null;
  payment_method: string; frequency: "weekly" | "monthly"; next_date: string; is_active: boolean;
}

const expenseCategories = [
  "Rent", "Electricity", "Salaries", "Tea & snacks", "Transportation", "Inventory", "Utilities", "Marketing",
  "Equipment", "Maintenance", "Insurance", "Other",
];
const METHODS: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", bank: "Bank transfer", cheque: "Cheque" };
const NEW_COLUMNS = /payment_method|paid_from_till|payee|receipt_path|status|column/;

export default function Expenses() {
  const { user } = useAuth();
  const { role } = useUserRole();
  const { filterStoreId, newRecordFields, workingStoreId } = useStore();
  const canApprove = role === "admin" || role === "manager" || role === "accountant";
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [month, setMonth] = useState(format(new Date(), "yyyy-MM"));
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [payee, setPayee] = useState("");
  const [method, setMethod] = useState("cash");
  const [fromTill, setFromTill] = useState(true);
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [newColumns, setNewColumns] = useState(true);
  // repeating
  const [recurring, setRecurring] = useState<Recurring[] | null>(null);
  const [rCat, setRCat] = useState("Rent");
  const [rAmount, setRAmount] = useState("");
  const [rPayee, setRPayee] = useState("");
  const [rFreq, setRFreq] = useState<"monthly" | "weekly">("monthly");
  const [rStart, setRStart] = useState(format(new Date(), "yyyy-MM-dd"));
  const [approvalAbove, setApprovalAbove] = useState<string | null>(null);

  const fetchExpenses = async () => {
    try {
      const start = `${month}-01`;
      const [y, m] = month.split("-").map(Number);
      const end = format(new Date(y, m, 1), "yyyy-MM-dd");
      const { data, error } = await inStore(supabase.from("expenses").select("*"), filterStoreId)
        .gte("date", start).lt("date", end)
        .order("date", { ascending: false });
      if (error) throw error;
      const rows = ((data || []) as any[]).map((e) => ({ ...e, amount: Number(e.amount) })) as Expense[];
      setNewColumns(rows.length === 0 ? newColumns : "status" in (data as any[])[0]);
      setExpenses(rows);
    } catch {
      toast({ title: "Error", description: "Failed to fetch expenses", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const fetchRecurring = async () => {
    if (!canApprove) return;
    const { data, error } = await inStore(supabase.from("recurring_expenses" as any).select("*"), filterStoreId).order("next_date");
    setRecurring(error ? null : ((data || []) as any[]).map((r) => ({ ...r, amount: Number(r.amount) })));
  };

  useEffect(() => {
    (async () => {
      if (canApprove) {
        const { data } = await supabase.rpc("post_recurring_expenses" as any);
        if (Number(data) > 0) toast({ title: `${data} repeating expense${Number(data) === 1 ? "" : "s"} added`, description: "Rent, salary and other regular bills that came due" });
      }
      fetchExpenses();
      fetchRecurring();
    })().catch(() => fetchExpenses());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStoreId, month, canApprove]);

  useEffect(() => {
    if (!workingStoreId || !canApprove) return;
    supabase.from("locations").select("expense_approval_above" as any).eq("id", workingStoreId).maybeSingle()
      .then(({ data, error }: any) => setApprovalAbove(error ? null : data?.expense_approval_above == null ? "" : String(Number(data.expense_approval_above))), () => undefined);
  }, [workingStoreId, canApprove]);

  const resetForm = () => {
    setAmount(""); setCategory(""); setDescription(""); setPayee(""); setMethod("cash"); setFromTill(true); setPhoto(null);
    setDate(format(new Date(), "yyyy-MM-dd"));
  };

  const uploadPhoto = async (): Promise<string | null> => {
    if (!photo) return null;
    const store = (newRecordFields.location_id || workingStoreId);
    if (!store) return null;
    if (photo.size > 5 * 1024 * 1024) { toast({ title: "Photo too big", description: "Use a photo under 5 MB", variant: "destructive" }); return null; }
    const ext = (photo.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
    const path = `${store}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("expense-receipts").upload(path, photo, { contentType: photo.type || undefined });
    if (error) { toast({ title: "Photo not saved", description: "The expense is saved without the photo", variant: "destructive" }); return null; }
    return path;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (!(amt > 0)) { toast({ title: "Enter the amount", variant: "destructive" }); return; }
    if (!category) { toast({ title: "Pick a category", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const base = { amount: amt, category, description: description.trim() || null, date, created_by: user.id, ...newRecordFields };
      const receipt = await uploadPhoto();
      const full: Record<string, any> = { ...base, payment_method: method, paid_from_till: method === "cash" && fromTill, payee: payee.trim() || null };
      if (receipt) full.receipt_path = receipt;
      let { data, error } = await supabase.from("expenses").insert(full as any).select().single();
      if (error && NEW_COLUMNS.test(error.message || "")) ({ data, error } = await supabase.from("expenses").insert(base).select().single());
      if (error) throw error;
      const pending = (data as any)?.status === "pending";
      toast({ title: pending ? "Expense waiting for approval" : "Expense added", description: pending ? "A manager needs to approve this amount" : `₹${amt.toLocaleString("en-IN")} ${category}` });
      resetForm();
      setShowForm(false);
      fetchExpenses();
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Failed to add expense", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const decide = async (exp: Expense, approve: boolean) => {
    const { error } = await supabase.rpc("decide_expense" as any, { p_expense_id: exp.id, p_approve: approve } as any);
    if (error) toast({ title: "Not saved", description: error.message, variant: "destructive" });
    else toast({ title: approve ? "Approved" : "Rejected" });
    fetchExpenses();
  };

  const viewPhoto = async (path: string) => {
    const { data, error } = await supabase.storage.from("expense-receipts").createSignedUrl(path, 300);
    if (error || !data?.signedUrl) { toast({ title: "Could not open the photo", variant: "destructive" }); return; }
    window.open(data.signedUrl, "_blank");
  };

  const addRecurring = async () => {
    const amt = parseFloat(rAmount);
    const store = newRecordFields.location_id || workingStoreId;
    if (!(amt > 0) || !store) { toast({ title: "Enter the amount", variant: "destructive" }); return; }
    const { error } = await supabase.from("recurring_expenses" as any).insert({
      location_id: store, category: rCat, amount: amt, payee: rPayee.trim() || null, frequency: rFreq, next_date: rStart, payment_method: "cash",
    } as any);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Repeating expense added", description: `${rCat} ₹${amt} every ${rFreq === "weekly" ? "week" : "month"} from ${rStart}` });
    setRAmount(""); setRPayee("");
    const { data } = await supabase.rpc("post_recurring_expenses" as any);
    if (Number(data) > 0) fetchExpenses();
    fetchRecurring();
  };

  const toggleRecurring = async (r: Recurring) => {
    await supabase.from("recurring_expenses" as any).update({ is_active: !r.is_active } as any).eq("id", r.id);
    fetchRecurring();
  };
  const deleteRecurring = async (r: Recurring) => {
    await supabase.from("recurring_expenses" as any).delete().eq("id", r.id);
    fetchRecurring();
  };

  const saveApprovalLimit = async () => {
    if (!workingStoreId || approvalAbove === null) return;
    const v = approvalAbove.trim() === "" ? null : Number(approvalAbove);
    if (v != null && !(v >= 0)) { toast({ title: "Enter an amount, or leave it empty", variant: "destructive" }); return; }
    const { error } = await supabase.from("locations").update({ expense_approval_above: v } as any).eq("id", workingStoreId);
    if (error) toast({ title: "Not saved", description: error.message, variant: "destructive" });
    else toast({ title: "Saved", description: v == null ? "No approval needed for expenses" : `Staff expenses over ₹${v} wait for a manager` });
  };

  const counted = expenses.filter((e) => !e.status || e.status === "approved");
  const pending = expenses.filter((e) => e.status === "pending");
  const monthTotal = counted.reduce((sum, e) => sum + e.amount, 0);
  const byCategory = Object.entries(counted.reduce<Record<string, number>>((acc, e) => { acc[e.category] = (acc[e.category] || 0) + e.amount; return acc; }, {}))
    .sort((a, b) => b[1] - a[1]);

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-3xl font-bold">Expenses</h1>
            <p className="text-muted-foreground">Shop spending, with receipts, approvals and repeating bills</p>
          </div>
          <div className="flex gap-2">
            <Input type="month" aria-label="Month" className="w-40" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            <Button onClick={() => setShowForm(!showForm)} className="gap-2"><Plus className="h-4 w-4" /> Add expense</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Spent this month</CardTitle>
              <IndianRupee className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">₹{monthTotal.toLocaleString("en-IN")}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Biggest heads</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              {byCategory.length === 0 ? <span className="text-muted-foreground">Nothing yet</span> : byCategory.slice(0, 3).map(([c, v]) => (
                <div key={c} className="flex justify-between"><span>{c}</span><span>₹{v.toLocaleString("en-IN")}</span></div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Waiting for approval</CardTitle>
            </CardHeader>
            <CardContent><div className={`text-2xl font-bold ${pending.length ? "text-destructive" : ""}`}>{pending.length}</div></CardContent>
          </Card>
        </div>

        {showForm && (
          <Card>
            <CardHeader><CardTitle>Add expense</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="amount">Amount (₹)</Label>
                    <Input id="amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Enter amount" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger aria-label="Category"><SelectValue placeholder="Select category" /></SelectTrigger>
                      <SelectContent>{expenseCategories.map((cat) => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="date">Date</Label>
                    <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                  </div>
                  {newColumns && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="payee">Paid to (optional)</Label>
                        <Input id="payee" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="e.g. landlord, electrician" />
                      </div>
                      <div className="space-y-2">
                        <Label>Paid by</Label>
                        <Select value={method} onValueChange={setMethod}>
                          <SelectTrigger aria-label="Paid by"><SelectValue /></SelectTrigger>
                          <SelectContent>{Object.entries(METHODS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                        </Select>
                        {method === "cash" && (
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked={fromTill} onCheckedChange={(v) => setFromTill(v === true)} /> Cash taken from the till (day closing counts it)
                          </label>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="photo">Bill / receipt photo (optional)</Label>
                        <Input id="photo" type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
                      </div>
                    </>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description (optional)</Label>
                  <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add expense description..." />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Add expense"}</Button>
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Expenses in {format(new Date(`${month}-01T12:00:00`), "MMMM yyyy")}</CardTitle></CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-4">Loading expenses...</div>
            ) : expenses.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No expenses this month.</div>
            ) : (
              <div className="space-y-3">
                {expenses.map((expense) => (
                  <div key={expense.id} className={`flex flex-wrap items-center justify-between gap-2 p-4 border rounded-lg ${expense.status === "rejected" ? "opacity-60" : ""}`}>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{expense.category}</Badge>
                        <span className="text-sm text-muted-foreground">{format(new Date(expense.date), "dd MMM yyyy")}</span>
                        {expense.status === "pending" && <Badge variant="destructive">Waiting for approval</Badge>}
                        {expense.status === "rejected" && <Badge variant="outline">Rejected</Badge>}
                        {expense.recurring_id && <Badge variant="outline" className="gap-1"><Repeat className="h-3 w-3" /> repeating</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {[expense.payee ? `To ${expense.payee}` : null, expense.payment_method ? METHODS[expense.payment_method] || expense.payment_method : null,
                          expense.paid_from_till ? "from till" : null, expense.description].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {expense.receipt_path && (
                        <Button size="sm" variant="ghost" aria-label="View receipt photo" onClick={() => viewPhoto(expense.receipt_path!)}><Paperclip className="h-4 w-4" /></Button>
                      )}
                      {canApprove && expense.status === "pending" && (
                        <>
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => decide(expense, true)}><Check className="h-4 w-4" /> Approve</Button>
                          <Button size="sm" variant="ghost" className="gap-1" onClick={() => decide(expense, false)}><X className="h-4 w-4" /> Reject</Button>
                        </>
                      )}
                      <div className="text-lg font-semibold w-28 text-right">₹{expense.amount.toLocaleString("en-IN")}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {canApprove && recurring !== null && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Repeat className="h-5 w-5" /> Repeating expenses</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6 items-end">
                <div className="space-y-1">
                  <Label>Category</Label>
                  <Select value={rCat} onValueChange={setRCat}>
                    <SelectTrigger aria-label="Repeating category"><SelectValue /></SelectTrigger>
                    <SelectContent>{expenseCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label htmlFor="r-amt">Amount ₹</Label><Input id="r-amt" type="number" min="0" value={rAmount} onChange={(e) => setRAmount(e.target.value)} /></div>
                <div className="space-y-1"><Label htmlFor="r-payee">Paid to</Label><Input id="r-payee" value={rPayee} onChange={(e) => setRPayee(e.target.value)} /></div>
                <div className="space-y-1">
                  <Label>Every</Label>
                  <Select value={rFreq} onValueChange={(v) => setRFreq(v as "monthly" | "weekly")}>
                    <SelectTrigger aria-label="How often"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="monthly">Month</SelectItem><SelectItem value="weekly">Week</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label htmlFor="r-start">First date</Label><Input id="r-start" type="date" value={rStart} onChange={(e) => setRStart(e.target.value)} /></div>
                <Button onClick={addRecurring}>Add</Button>
              </div>
              {recurring.length > 0 && (
                <div className="space-y-2">
                  {recurring.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border rounded-md p-3 text-sm">
                      <span>
                        <b>{r.category}</b> ₹{r.amount.toLocaleString("en-IN")}{r.payee ? ` to ${r.payee}` : ""} every {r.frequency === "weekly" ? "week" : "month"}
                        <span className="text-muted-foreground"> · next {format(new Date(`${r.next_date}T12:00:00`), "dd MMM yyyy")}</span>
                        {!r.is_active && <Badge variant="secondary" className="ml-2">Paused</Badge>}
                      </span>
                      <span className="flex gap-1">
                        <Button size="sm" variant="outline" className="h-7" onClick={() => toggleRecurring(r)}>{r.is_active ? "Pause" : "Resume"}</Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Delete repeating ${r.category}`} onClick={() => deleteRecurring(r)}><Trash2 className="h-4 w-4" /></Button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">They are added by themselves on their date, the next time a manager opens this page.</p>
              {approvalAbove !== null && (
                <div className="flex flex-wrap items-end gap-2 border-t pt-4">
                  <div className="space-y-1">
                    <Label htmlFor="exp-limit">Staff expenses above ₹ need approval</Label>
                    <Input id="exp-limit" className="w-48" inputMode="decimal" placeholder="No approval needed" value={approvalAbove} onChange={(e) => setApprovalAbove(e.target.value)} />
                  </div>
                  <Button variant="outline" onClick={saveApprovalLimit}>Save</Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
