import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useStore, inStore } from "@/hooks/useStore";
import { toast } from "@/hooks/use-toast";
import { rupees } from "@/lib/statement";
import { Pencil, Plus, UserCog, Wallet } from "lucide-react";

type Status = "present" | "half_day" | "absent" | "paid_leave";
interface StaffRow {
  id: string; location_id: string; name: string; phone: string | null; job_title: string | null; user_id: string | null;
  pay_type: "monthly" | "daily"; salary: number; commission_pct: number; shift_start: string | null; shift_end: string | null;
  weekly_off: number | null; joined_on: string | null; is_active: boolean;
}
interface Att { id: string; staff_id: string; date: string; status: Status; check_in: string | null; check_out: string | null; late_minutes: number; }
interface Summary {
  staff_id: string; name: string; job_title: string | null; pay_type: string; salary: number; commission_pct: number;
  present: number; half_days: number; absent: number; paid_leave: number; late_days: number; unmarked: number; paid_days: number;
  earned: number; sales_total: number; commission: number; advances: number; payable: number; paid: boolean; net_paid: number | null;
}
interface Profile { user_id: string; full_name: string | null; }

const STATUS: { key: Status; label: string; short: string }[] = [
  { key: "present", label: "Present", short: "P" },
  { key: "half_day", label: "Half day", short: "½" },
  { key: "absent", label: "Absent", short: "A" },
  { key: "paid_leave", label: "Paid leave", short: "L" },
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "");
const num = (o: any, keys: string[]) => { const r = { ...o }; keys.forEach((k) => { if (r[k] != null) r[k] = Number(r[k]); }); return r; };
const EMPTY = { name: "", phone: "", job_title: "", user_id: "", pay_type: "monthly", salary: "", commission_pct: "", shift_start: "", shift_end: "", weekly_off: "", joined_on: "", is_active: true };

export default function Staff() {
  const { filterStoreId, workingStoreId } = useStore();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  const load = async () => {
    const { data, error } = await inStore(supabase.from("staff" as any).select("*"), filterStoreId).order("name");
    if (error) {
      if (["PGRST205", "42P01"].includes(error.code || "") || /could not find the table/i.test(error.message || "")) { setAvailable(false); return; }
      toast({ title: "Couldn't load staff", description: error.message, variant: "destructive" });
    }
    setAvailable(true);
    setStaff(((data || []) as any[]).map((s) => num(s, ["salary", "commission_pct"])));
    const { data: p } = await supabase.from("profiles").select("user_id, full_name");
    setProfiles((p || []) as any);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStoreId]);

  if (available === false) {
    return <Layout><Card><CardContent className="py-10 text-center text-muted-foreground">Staff and attendance need the latest database update (dailykart-updates.sql). Everything else keeps working.</CardContent></Card></Layout>;
  }

  return (
    <Layout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><UserCog className="h-6 w-6" /> Staff</h1>
          <p className="text-sm text-muted-foreground">Attendance, shifts, advances, salary and sales commission.</p>
        </div>
        <Tabs defaultValue="today">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="today">Today's attendance</TabsTrigger>
            <TabsTrigger value="month">Month &amp; salary</TabsTrigger>
            <TabsTrigger value="people">Staff list</TabsTrigger>
          </TabsList>
          <TabsContent value="today"><TodayTab staff={staff.filter((s) => s.is_active)} /></TabsContent>
          <TabsContent value="month"><MonthTab storeId={filterStoreId} /></TabsContent>
          <TabsContent value="people"><PeopleTab staff={staff} profiles={profiles} storeId={workingStoreId} onChanged={load} /></TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

function TodayTab({ staff }: { staff: StaffRow[] }) {
  const [date, setDate] = useState(today());
  const [att, setAtt] = useState<Record<string, Att>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    if (!staff.length) { setAtt({}); return; }
    const { data } = await supabase.from("attendance" as any).select("*").eq("date", date).in("staff_id", staff.map((s) => s.id));
    const m: Record<string, Att> = {};
    ((data || []) as any[]).forEach((a) => { m[a.staff_id] = a; });
    setAtt(m);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, staff]);

  const mark = async (s: StaffRow, status: Status) => {
    setBusy(s.id);
    const existing = att[s.id];
    const { error } = existing
      ? await supabase.from("attendance" as any).update({ status } as any).eq("id", existing.id)
      : await supabase.from("attendance" as any).insert({ staff_id: s.id, location_id: s.location_id, date, status } as any);
    setBusy(null);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    load();
  };

  const dow = new Date(date + "T00:00:00").getDay();
  const counts = STATUS.map((st) => ({ ...st, n: Object.values(att).filter((a) => a.status === st.key).length }));
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-lg">Attendance</CardTitle>
        <div className="flex items-center gap-2">
          <Label htmlFor="att-date" className="sr-only">Date</Label>
          <Input id="att-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className="w-44" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 text-sm">
          {counts.map((c) => <Badge key={c.key} variant="secondary">{c.label}: {c.n}</Badge>)}
          <Badge variant="outline">Not marked: {staff.length - Object.keys(att).length}</Badge>
        </div>
        {staff.length === 0 ? <p className="text-center text-muted-foreground py-4">Add your staff in the Staff list tab first</p> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Shift</TableHead><TableHead>In / out</TableHead><TableHead>Mark</TableHead></TableRow></TableHeader>
              <TableBody>
                {staff.map((s) => {
                  const a = att[s.id];
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="font-medium">{s.name}</div>
                        <div className="text-xs text-muted-foreground">{s.job_title || ""}{s.weekly_off === dow ? " · weekly off today" : ""}</div>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{s.shift_start ? `${s.shift_start.slice(0, 5)}–${(s.shift_end || "").slice(0, 5)}` : "-"}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {a?.check_in ? `${time(a.check_in)} – ${time(a.check_out) || "…"}` : "-"}
                        {a && a.late_minutes > 0 && <Badge variant="destructive" className="ml-2">Late {a.late_minutes} min</Badge>}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {STATUS.map((st) => (
                            <Button key={st.key} size="sm" variant={a?.status === st.key ? "default" : "outline"} disabled={busy === s.id}
                              aria-label={`${s.name}: ${st.label}`} aria-pressed={a?.status === st.key} onClick={() => mark(s, st.key)}>
                              {st.label}
                            </Button>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Staff linked to an app login can clock in and out themselves from the Dashboard. Days left unmarked count as present for monthly pay.</p>
      </CardContent>
    </Card>
  );
}

function MonthTab({ storeId }: { storeId: string | null }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [rows, setRows] = useState<Summary[]>([]);
  const [payFor, setPayFor] = useState<Summary | null>(null);
  const [advFor, setAdvFor] = useState<Summary | null>(null);

  const load = async () => {
    const { data, error } = await supabase.rpc("staff_month_summary" as any, { p_month: `${month}-01`, p_location_id: storeId } as any);
    if (error) { toast({ title: "Couldn't load month", description: error.message, variant: "destructive" }); return; }
    setRows(((data || []) as any[]).map((r) => num(r, ["salary", "commission_pct", "present", "half_days", "absent", "paid_leave", "late_days", "unmarked", "paid_days", "earned", "sales_total", "commission", "advances", "payable", "net_paid"])));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, storeId]);

  const total = rows.reduce((s, r) => s + (r.paid ? 0 : Math.max(r.payable, 0)), 0);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-lg">Month summary</CardTitle>
        <Input type="month" aria-label="Month" value={month} max={today().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-44" />
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? <p className="text-center text-muted-foreground py-4">No staff for this month</p> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Name</TableHead><TableHead>Days</TableHead><TableHead className="text-right">Earned</TableHead>
                <TableHead className="text-right">Commission</TableHead><TableHead className="text-right">Advances</TableHead>
                <TableHead className="text-right">To pay</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.staff_id}>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.pay_type === "daily" ? `${rupees(r.salary)} a day` : `${rupees(r.salary)} a month`}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>P {r.present} · ½ {r.half_days} · A {r.absent} · L {r.paid_leave}</div>
                      <div className="text-muted-foreground">Paid days {r.paid_days}{r.late_days ? ` · late ${r.late_days}×` : ""}{r.unmarked ? ` · ${r.unmarked} not marked` : ""}</div>
                    </TableCell>
                    <TableCell className="text-right">{rupees(r.earned)}</TableCell>
                    <TableCell className="text-right">{r.commission ? <span title={`${r.commission_pct}% of ${rupees(r.sales_total)}`}>{rupees(r.commission)}</span> : "-"}</TableCell>
                    <TableCell className="text-right">{r.advances ? `− ${rupees(r.advances)}` : "-"}</TableCell>
                    <TableCell className="text-right font-medium">{r.paid ? <Badge variant="secondary">Paid {rupees(r.net_paid || 0)}</Badge> : rupees(r.payable)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => setAdvFor(r)}>Advance</Button>
                      {!r.paid && <Button size="sm" className="gap-1" onClick={() => setPayFor(r)}><Wallet className="h-4 w-4" /> Pay</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {total > 0 && <p className="text-sm">Still to pay this month: <b>{rupees(total)}</b></p>}
        <p className="text-xs text-muted-foreground">Monthly pay: salary less a day's pay for each absent day (half for a half day). Commission is on the person's own bills before GST, when they are linked to an app login. Advances and salary are saved as Salary expenses.</p>
      </CardContent>
      {payFor && <PayDialog row={payFor} month={month} onClose={() => setPayFor(null)} onDone={() => { setPayFor(null); load(); }} />}
      {advFor && <AdvanceDialog row={advFor} onClose={() => setAdvFor(null)} onDone={() => { setAdvFor(null); load(); }} />}
    </Card>
  );
}

function MethodPicker({ method, setMethod, fromTill, setFromTill }: { method: string; setMethod: (v: string) => void; fromTill: boolean; setFromTill: (v: boolean) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 items-end">
      <div className="space-y-1">
        <Label>Paid by</Label>
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger aria-label="Paid by"><SelectValue /></SelectTrigger>
          <SelectContent>{["cash", "upi", "bank", "cheque"].map((m) => <SelectItem key={m} value={m}>{m === "upi" ? "UPI" : m[0].toUpperCase() + m.slice(1)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {method === "cash" && (
        <label className="flex items-center gap-2 text-sm pb-2"><Checkbox checked={fromTill} onCheckedChange={(v) => setFromTill(v === true)} /> Taken from today's till</label>
      )}
    </div>
  );
}

function PayDialog({ row, month, onClose, onDone }: { row: Summary; month: string; onClose: () => void; onDone: () => void }) {
  const [bonus, setBonus] = useState("");
  const [ded, setDed] = useState("");
  const [method, setMethod] = useState("cash");
  const [fromTill, setFromTill] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const net = Math.round((row.earned + row.commission + (parseFloat(bonus) || 0) - (parseFloat(ded) || 0) - row.advances) * 100) / 100;
  const pay = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("pay_staff_salary" as any, {
      p_staff_id: row.staff_id, p_month: `${month}-01`, p_bonus: parseFloat(bonus) || 0, p_deductions: parseFloat(ded) || 0,
      p_method: method, p_from_till: fromTill, p_note: note.trim() || null,
    } as any);
    setBusy(false);
    if (error) { toast({ title: "Not paid", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Salary paid to ${row.name}`, description: rupees(net) });
    onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Pay {row.name}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between"><span>Earned ({row.paid_days} paid days)</span><span>{rupees(row.earned)}</span></div>
          {row.commission > 0 && <div className="flex justify-between"><span>Commission</span><span>{rupees(row.commission)}</span></div>}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label htmlFor="pay-bonus">Bonus</Label><Input id="pay-bonus" type="number" min="0" value={bonus} onChange={(e) => setBonus(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="pay-ded">Deductions</Label><Input id="pay-ded" type="number" min="0" value={ded} onChange={(e) => setDed(e.target.value)} /></div>
          </div>
          {row.advances > 0 && <div className="flex justify-between"><span>Less advances</span><span>− {rupees(row.advances)}</span></div>}
          <div className="flex justify-between border-t pt-2 font-semibold"><span>To pay now</span><span className={net < 0 ? "text-destructive" : ""}>{rupees(net)}</span></div>
          <MethodPicker method={method} setMethod={setMethod} fromTill={fromTill} setFromTill={setFromTill} />
          <Input placeholder="Note (optional)" aria-label="Salary note" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button className="w-full" onClick={pay} disabled={busy || net < 0}>Pay {rupees(Math.max(net, 0))}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AdvanceDialog({ row, onClose, onDone }: { row: Summary; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [fromTill, setFromTill] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const give = async () => {
    if (!(parseFloat(amount) > 0)) { toast({ title: "Enter the amount", variant: "destructive" }); return; }
    setBusy(true);
    const { error } = await supabase.rpc("give_staff_advance" as any, { p_staff_id: row.staff_id, p_amount: parseFloat(amount), p_method: method, p_from_till: fromTill, p_note: note.trim() || null } as any);
    setBusy(false);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Advance of ${rupees(parseFloat(amount))} given to ${row.name}`, description: "It will be taken from the next salary" });
    onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Advance to {row.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor="adv-amount">Amount (₹)</Label><Input id="adv-amount" type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <MethodPicker method={method} setMethod={setMethod} fromTill={fromTill} setFromTill={setFromTill} />
          <Input placeholder="Reason (optional)" aria-label="Advance reason" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button className="w-full" onClick={give} disabled={busy}>Give advance</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PeopleTab({ staff, profiles, storeId, onChanged }: { staff: StaffRow[]; profiles: Profile[]; storeId: string | null; onChanged: () => void }) {
  const [edit, setEdit] = useState<StaffRow | "new" | null>(null);
  const [f, setF] = useState<typeof EMPTY>({ ...EMPTY });
  const [busy, setBusy] = useState(false);

  const open = (s: StaffRow | "new") => {
    setEdit(s);
    setF(s === "new" ? { ...EMPTY } : {
      name: s.name, phone: s.phone || "", job_title: s.job_title || "", user_id: s.user_id || "", pay_type: s.pay_type,
      salary: String(s.salary || ""), commission_pct: s.commission_pct ? String(s.commission_pct) : "", shift_start: (s.shift_start || "").slice(0, 5),
      shift_end: (s.shift_end || "").slice(0, 5), weekly_off: s.weekly_off == null ? "" : String(s.weekly_off), joined_on: s.joined_on || "", is_active: s.is_active,
    });
  };
  const save = async () => {
    if (!f.name.trim()) { toast({ title: "Enter the name", variant: "destructive" }); return; }
    const row: any = {
      name: f.name.trim(), phone: f.phone.trim() || null, job_title: f.job_title.trim() || null, user_id: f.user_id || null,
      pay_type: f.pay_type, salary: parseFloat(f.salary) || 0, commission_pct: parseFloat(f.commission_pct) || 0,
      shift_start: f.shift_start || null, shift_end: f.shift_end || null, weekly_off: f.weekly_off === "" ? null : Number(f.weekly_off),
      joined_on: f.joined_on || null, is_active: f.is_active,
    };
    if (edit === "new") {
      if (!storeId) { toast({ title: "Pick a store at the top first", variant: "destructive" }); return; }
      row.location_id = storeId;
    }
    setBusy(true);
    const { error } = edit === "new"
      ? await supabase.from("staff" as any).insert(row)
      : await supabase.from("staff" as any).update(row).eq("id", (edit as StaffRow).id);
    setBusy(false);
    if (error) {
      toast({ title: "Not saved", description: /uq_staff_user/.test(error.message) ? "That login is already linked to another staff member" : error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Saved" });
    setEdit(null);
    onChanged();
  };
  const set = (k: keyof typeof EMPTY, v: any) => setF((x) => ({ ...x, [k]: v }));
  const login = (id: string | null) => profiles.find((p) => p.user_id === id)?.full_name || (id ? "Linked" : "");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Staff list</CardTitle>
        <Button className="gap-1" onClick={() => open("new")}><Plus className="h-4 w-4" /> Add staff</Button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {staff.length === 0 ? <p className="text-center text-muted-foreground py-4">No staff yet</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Pay</TableHead><TableHead>Shift</TableHead><TableHead>App login</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {staff.map((s) => (
                <TableRow key={s.id} className={s.is_active ? "" : "opacity-60"}>
                  <TableCell><div className="font-medium">{s.name}{!s.is_active && <Badge variant="outline" className="ml-2">Left</Badge>}</div><div className="text-xs text-muted-foreground">{[s.job_title, s.phone].filter(Boolean).join(" · ")}</div></TableCell>
                  <TableCell className="text-sm">{rupees(s.salary)} {s.pay_type === "daily" ? "a day" : "a month"}{s.commission_pct ? ` + ${s.commission_pct}%` : ""}</TableCell>
                  <TableCell className="text-sm">{s.shift_start ? `${s.shift_start.slice(0, 5)}–${(s.shift_end || "").slice(0, 5)}` : "-"}{s.weekly_off != null ? ` · off ${DAYS[s.weekly_off].slice(0, 3)}` : ""}</TableCell>
                  <TableCell className="text-sm">{login(s.user_id) || "-"}</TableCell>
                  <TableCell><Button size="icon" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => open(s)}><Pencil className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{edit === "new" ? "Add staff" : `Edit ${(edit as StaffRow).name}`}</DialogTitle></DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="st-name">Name</Label><Input id="st-name" value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="st-phone">Phone</Label><Input id="st-phone" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="st-job">Job</Label><Input id="st-job" placeholder="e.g. Helper, Cashier" value={f.job_title} onChange={(e) => set("job_title", e.target.value)} /></div>
              <div className="space-y-1">
                <Label>App login (optional)</Label>
                <Select value={f.user_id || "none"} onValueChange={(v) => set("user_id", v === "none" ? "" : v)}>
                  <SelectTrigger aria-label="App login"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No login</SelectItem>
                    {profiles.map((p) => <SelectItem key={p.user_id} value={p.user_id}>{p.full_name || "User"}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Pay type</Label>
                <Select value={f.pay_type} onValueChange={(v) => set("pay_type", v)}>
                  <SelectTrigger aria-label="Pay type"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="monthly">Monthly salary</SelectItem><SelectItem value="daily">Daily wage</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label htmlFor="st-salary">{f.pay_type === "daily" ? "Wage per day (₹)" : "Salary per month (₹)"}</Label><Input id="st-salary" type="number" min="0" value={f.salary} onChange={(e) => set("salary", e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="st-comm">Sales commission %</Label><Input id="st-comm" type="number" min="0" max="100" step="0.1" placeholder="0" value={f.commission_pct} onChange={(e) => set("commission_pct", e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="st-joined">Joined on</Label><Input id="st-joined" type="date" value={f.joined_on} onChange={(e) => set("joined_on", e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="st-start">Shift starts</Label><Input id="st-start" type="time" value={f.shift_start} onChange={(e) => set("shift_start", e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="st-end">Shift ends</Label><Input id="st-end" type="time" value={f.shift_end} onChange={(e) => set("shift_end", e.target.value)} /></div>
              <div className="space-y-1">
                <Label>Weekly off</Label>
                <Select value={f.weekly_off === "" ? "none" : f.weekly_off} onValueChange={(v) => set("weekly_off", v === "none" ? "" : v)}>
                  <SelectTrigger aria-label="Weekly off"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">None</SelectItem>{DAYS.map((d, i) => <SelectItem key={d} value={String(i)}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm pt-6"><Checkbox checked={f.is_active} onCheckedChange={(v) => set("is_active", v === true)} /> Still working here</label>
            </div>
            {f.commission_pct && !f.user_id && <p className="text-xs text-muted-foreground">Commission is worked out from the bills this person makes, so link their app login.</p>}
            <Button onClick={save} disabled={busy}>Save</Button>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
