// Khata ageing (with each customer's statement), the payment register and
// register (day closing) variance (Phase 5). Figures come from
// report_khata_ageing / report_khata_statement / report_payment_register /
// report_registers; tables are paged on the server.
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { inrShort } from "@/lib/dashboard";
import { AgeingFilter, AgeingRow, reportKhataAgeing, reportKhataStatement, reportPaymentRegister, reportRegisters } from "@/lib/reports/api";
import { rangeLabel } from "@/lib/reports/dates";
import { ReportCtx, allPages, csvMeta, csvName, useReportData } from "./context";
import { Kpi, Loaded, METHOD_LABEL, NoData, Section, fmtBucket, inr, num } from "./shared";
import { Pager, useDebounced } from "./paging";
import { NeedsUpdate as Needs, useMissing } from "./missing";

const R = "text-right";
const NeedsUpdate = () => <Needs file="phase5-reports-khata-payments.sql" />;
const plural = (n: number, one: string, many = one + "s") => `${num(n)} ${n === 1 ? one : many}`;
const day = (s: string | null | undefined) =>
  s ? new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Kolkata" }) : "—";
const dateTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—";
const methodLabel = (m: string | null) => (m ? METHOD_LABEL[m] ?? (m === "cheque" ? "Cheque" : m === "khata" ? "Khata" : m) : "—");

// ---------------------------------------------------------------- khata ageing
const BUCKETS: { key: keyof AgeingRow & string; label: string; color: string }[] = [
  { key: "d0_7", label: "0–7 days", color: "hsl(var(--success))" },
  { key: "d8_15", label: "8–15 days", color: "hsl(var(--primary))" },
  { key: "d16_30", label: "16–30 days", color: "hsl(var(--warning))" },
  { key: "d31_60", label: "31–60 days", color: "hsl(var(--destructive) / 0.7)" },
  { key: "d60_plus", label: "Over 60 days", color: "hsl(var(--destructive))" },
];
const AGEING_FILTERS: { key: AgeingFilter; label: string }[] = [
  { key: "all", label: "Everyone who owes" },
  ...BUCKETS.map((b) => ({ key: b.key as AgeingFilter, label: `Oldest due ${b.label}` })),
  { key: "overdue", label: "Past their credit days" }, { key: "over_limit", label: "Over credit limit" }, { key: "advance", label: "Paid in advance" },
];
const AGEING_SORTS = [{ key: "due", label: "Amount owed" }, { key: "age", label: "Oldest due" }, { key: "overdue", label: "Overdue" }, { key: "last_payment", label: "Last payment" }, { key: "name", label: "Name" }];

export function KhataAgeing({ ctx }: { ctx: ReportCtx }) {
  const [missing, onMissing] = useMissing();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [bucket, setBucket] = useState<AgeingFilter>("all");
  const [sort, setSort] = useState("due");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const [open, setOpen] = useState<AgeingRow | null>(null);
  useEffect(() => { setPage(0); }, [q, bucket, sort, dir, ctx.run, ctx.storeId]);
  const state = useReportData(
    () => reportKhataAgeing(ctx.storeId, { search: q || null, bucket, sort, dir, limit: size, offset: page * size }),
    [ctx.run, ctx.storeId, q, bucket, sort, dir, page, size], onMissing,
  );
  if (missing) return <NeedsUpdate />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input className="w-full sm:w-56" placeholder="Search name or phone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customers" />
        <Select value={bucket} onValueChange={(v) => setBucket(v as AgeingFilter)}>
          <SelectTrigger className="w-full sm:w-56" aria-label="Show"><SelectValue /></SelectTrigger>
          <SelectContent>{AGEING_FILTERS.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => { setSort(v); setDir(v === "name" ? "asc" : "desc"); }}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Sort by"><SelectValue /></SelectTrigger>
          <SelectContent>{AGEING_SORTS.map((s) => <SelectItem key={s.key} value={s.key}>Sort: {s.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" onClick={() => setDir(dir === "desc" ? "asc" : "desc")} aria-label="Reverse order">{dir === "desc" ? "Highest first" : "Lowest first"}</Button>
      </div>
      <Loaded state={state} kpis={4}>
        {(ag) => {
          const t = ag.totals;
          const chart = BUCKETS.map((b) => ({ key: b.key, name: b.label, amount: t[b.key as keyof typeof t] as number, color: b.color }));
          const label = AGEING_FILTERS.find((f) => f.key === bucket)?.label ?? "";
          return (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi k="customer_outstanding" value={inr(t.outstanding)} hint={`${plural(t.customers_owing, "customer")} · now`} onClick={() => setBucket("all")} />
                <Kpi label="Past credit days" value={inr(t.overdue)} hint={plural(t.customers_overdue, "customer")} tone={t.overdue > 0 ? "bad" : undefined} onClick={() => setBucket("overdue")} />
                <Kpi label="Older than 60 days" value={inr(t.d60_plus)} tone={t.d60_plus > 0 ? "bad" : undefined} onClick={() => setBucket("d60_plus")}
                  hint={t.outstanding > 0 ? `${((t.d60_plus / t.outstanding) * 100).toFixed(1)}% of dues` : undefined} />
                <Kpi label="Paid in advance" value={inr(t.advance)} hint={plural(t.customers_advance, "customer")} onClick={() => setBucket("advance")} />
              </div>
              {t.outstanding > 0 && (
                <Section title="Dues by age" description={`How long the unpaid amounts have been owed, as of ${day(ag.as_of)}. Payments clear the oldest bill first. Tap a bar to list those customers.`}
                  csv={{ filename: `dailykart-khata-ageing-summary-${ag.as_of}.csv`, meta: csvMeta(ctx, "Khata dues by age", [`As of ${ag.as_of}`]),
                    rows: [...chart.map((c) => ({ age: c.name, amount: c.amount })), { age: "Total", amount: t.outstanding }, { age: "Past credit days (included above)", amount: t.overdue }] }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={chart} onClick={(e) => { const k = (e as { activePayload?: { payload?: { key?: string } }[] })?.activePayload?.[0]?.payload?.key; if (k) setBucket(k as AgeingFilter); }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tickFormatter={(v) => inrShort(Number(v))} width={60} />
                      <Tooltip formatter={(v) => [inr(Number(v)), "Owed"]} />
                      <Bar dataKey="amount" name="Owed" radius={[3, 3, 0, 0]} className="cursor-pointer">
                        {chart.map((c) => <Cell key={c.key} fill={c.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Section>
              )}
              {ag.total === 0 ? (
                <NoData title={q ? "No customer matches" : bucket === "all" ? "Nobody owes anything right now" : `No customers: ${label.toLowerCase()}`} />
              ) : (
                <Section title={label} description="Amount owed now, split by how old it is. Tap a customer for their khata statement."
                  csv={{ filename: `dailykart-khata-ageing-${ag.as_of}.csv`, meta: csvMeta(ctx, "Khata ageing", [`As of ${ag.as_of}`, `Show: ${label}`, "Payments clear the oldest bill first", `Rows ${page * size + 1} to ${page * size + ag.rows.length} of ${ag.total}`, ...(q ? [`Search: ${q}`] : [])]),
                    rows: ag.rows.map((r) => ({ customer: r.name, phone: r.phone, group: r.customer_group ?? "", owes: r.balance, days_0_7: r.d0_7, days_8_15: r.d8_15, days_16_30: r.d16_30,
                      days_31_60: r.d31_60, over_60_days: r.d60_plus, past_credit_days: r.overdue, oldest_due_days: r.oldest_age ?? "", credit_days: r.credit_days ?? "", credit_limit: r.credit_limit ?? "",
                      last_payment: r.last_payment_at ?? "" })), all: allPages((limit, offset) => reportKhataAgeing(ctx.storeId, { search: q || null, bucket, sort, dir, limit, offset }), (r) => ({ customer: r.name, phone: r.phone, group: r.customer_group ?? "", owes: r.balance, days_0_7: r.d0_7, days_8_15: r.d8_15, days_16_30: r.d16_30,
                      days_31_60: r.d31_60, over_60_days: r.d60_plus, past_credit_days: r.overdue, oldest_due_days: r.oldest_age ?? "", credit_days: r.credit_days ?? "", credit_limit: r.credit_limit ?? "",
                      last_payment: r.last_payment_at ?? "" })) }}>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Customer</TableHead><TableHead className={R}>Owes</TableHead>
                      {BUCKETS.map((b) => <TableHead key={b.key} className={`${R} whitespace-nowrap`}>{b.label.replace(" days", "d").replace("Over 60d", "60d+")}</TableHead>)}
                      <TableHead className={R}>Overdue</TableHead><TableHead>Last paid</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {ag.rows.map((r) => (
                        <TableRow key={r.customer_id} className="cursor-pointer" onClick={() => setOpen(r)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setOpen(r); }}>
                          <TableCell className="min-w-[150px]">
                            <div className="font-medium text-primary underline-offset-2 hover:underline">{r.name}</div>
                            <div className="text-xs text-muted-foreground">{r.phone}{r.credit_days !== null ? ` · ${r.credit_days}d credit` : ""}</div>
                            {r.credit_limit !== null && r.balance > r.credit_limit && <Badge variant="outline" className="mt-0.5 bg-destructive/10 text-destructive border-destructive/30 whitespace-nowrap">over limit {inr(r.credit_limit)}</Badge>}
                          </TableCell>
                          <TableCell className={`${R} font-medium whitespace-nowrap ${r.balance < 0 ? "text-success" : ""}`}>
                            {r.balance < 0 ? `${inr(-r.balance, 2)} adv.` : inr(r.balance, 2)}
                          </TableCell>
                          {BUCKETS.map((b) => {
                            const v = r[b.key] as number;
                            return <TableCell key={b.key} className={`${R} ${v > 0 && (b.key === "d60_plus" || b.key === "d31_60") ? "text-destructive" : ""}`}>{v ? inr(v) : "—"}</TableCell>;
                          })}
                          <TableCell className={`${R} ${r.overdue > 0 ? "text-destructive font-medium" : ""}`}>{r.overdue ? inr(r.overdue) : "—"}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs">{r.last_payment_at ? <>{day(r.last_payment_at)}<div className="text-muted-foreground">{r.days_since_payment === 0 ? "today" : `${r.days_since_payment}d ago`}</div></> : <span className="text-muted-foreground">never</span>}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Pager page={page} size={size} total={ag.total} setPage={setPage} setSize={setSize} />
                </Section>
              )}
            </>
          );
        }}
      </Loaded>
      <Sheet open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          {open && <KhataStatement ctx={ctx} row={open} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { opening: "Opening balance", udhaar: "Udhaar bill", payment: "Payment received", refund: "Return to khata" };

function KhataStatement({ ctx, row }: { ctx: ReportCtx; row: AgeingRow }) {
  const state = useReportData(() => reportKhataStatement(row.customer_id, ctx.range.from, ctx.range.to), [row.customer_id, ctx.run], () => undefined);
  return (
    <>
      <SheetHeader>
        <SheetTitle>{row.name}</SheetTitle>
        <SheetDescription>Khata statement, {rangeLabel(ctx.range)}. {row.phone ?? ""}</SheetDescription>
      </SheetHeader>
      <div className="mt-4 space-y-4">
        <Loaded state={state} kpis={4}>
          {(st) => (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Kpi label="Opening" value={inr(st.opening, 2)} hint={`on ${day(st.from)}`} />
                <Kpi label="Udhaar added" value={inr(st.udhaar, 2)} />
                <Kpi label="Received" value={inr(st.received, 2)} tone={st.received > 0 ? "good" : undefined} />
                <Kpi label="Closing" value={inr(st.closing, 2)} hint={st.balance_now !== st.closing ? `${inr(st.balance_now, 2)} now` : "same as now"} />
              </div>
              <Section title="Entries" description="Payments clear the oldest bills first."
                csv={{ filename: `dailykart-khata-${row.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${st.from}-to-${st.to}.csv`,
                  meta: csvMeta(ctx, `Khata statement: ${row.name}`, [`Phone: ${row.phone ?? ""}`, `Opening: ${st.opening}`, `Closing: ${st.closing}`]),
                  rows: [{ date: st.from, entry: "Opening balance", ref: "", method: "", amount: "", balance: st.opening },
                    ...st.rows.map((r) => ({ date: r.at, entry: KIND_LABEL[r.kind] ?? r.kind, ref: r.ref ?? "", method: methodLabel(r.method), amount: r.amount, balance: r.running }))] }}>
                {st.rows.length === 0 ? <p className="text-sm text-muted-foreground py-4">No khata entries in these dates.</p> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Entry</TableHead><TableHead className={R}>Amount</TableHead><TableHead className={R}>Balance</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {st.rows.map((r, i) => (
                        <TableRow key={`${r.ref_id ?? r.kind}-${i}`}>
                          <TableCell className="whitespace-nowrap text-xs">{dateTime(r.at)}</TableCell>
                          <TableCell>{KIND_LABEL[r.kind] ?? r.kind}<div className="text-xs text-muted-foreground">{[r.ref, r.kind === "payment" ? methodLabel(r.method) : null, r.note].filter(Boolean).join(" · ")}</div></TableCell>
                          <TableCell className={`${R} ${r.amount < 0 ? "text-success" : ""}`}>{r.amount < 0 ? `−${inr(-r.amount, 2)}` : `+${inr(r.amount, 2)}`}</TableCell>
                          <TableCell className={`${R} font-medium`}>{inr(r.running, 2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter><TableRow><TableCell colSpan={3}>Closing balance</TableCell><TableCell className={R}>{inr(st.closing, 2)}</TableCell></TableRow></TableFooter>
                  </Table>
                )}
                {st.total > st.rows.length && <p className="text-xs text-muted-foreground pt-2">Showing the first {st.rows.length} of {st.total} entries. Pick shorter dates to see the rest.</p>}
              </Section>
            </>
          )}
        </Loaded>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- payment register
const KIND_NAMES: Record<string, string> = { bill: "Bill payments", khata: "Khata payments received", refund: "Refunds to customers", supplier: "Paid to suppliers", expense: "Expenses" };
const METHODS = ["cash", "upi", "card", "bank", "cheque"];

export function PaymentRegisterView({ ctx }: { ctx: ReportCtx }) {
  const [missing, onMissing] = useMissing();
  const [method, setMethod] = useState("all");
  const [kind, setKind] = useState("all");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  useEffect(() => { setPage(0); }, [q, method, kind, ctx.run, ctx.storeId]);
  const state = useReportData(
    () => reportPaymentRegister(ctx.range.from, ctx.range.to, ctx.storeId, { method: method === "all" ? null : method, kind: kind === "all" ? null : kind, search: q || null, limit: size, offset: page * size }),
    [ctx.run, ctx.storeId, method, kind, q, page, size], onMissing,
  );
  if (missing) return <NeedsUpdate />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input className="w-full sm:w-56" placeholder="Search bill no., customer, supplier" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search payments" />
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Method"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All methods</SelectItem>{METHODS.map((m) => <SelectItem key={m} value={m}>{methodLabel(m)}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-full sm:w-52" aria-label="Type"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Money in and out</SelectItem>{Object.entries(KIND_NAMES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Loaded state={state} kpis={4}>
        {(pr) => {
          const tin = pr.by_method.reduce((s, m) => s + m.money_in, 0);
          const tout = pr.by_method.reduce((s, m) => s + m.money_out, 0);
          const cash = pr.by_method.find((m) => m.key === "cash");
          const chart = pr.by_day.map((d) => ({ ...d, label: fmtBucket(d.bucket, "day") }));
          return (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi k="collections" label="Money in" value={inr(tin)} hint="bills and khata payments" tone="good" />
                <Kpi label="Money out" value={inr(tout)} hint="refunds, suppliers, expenses" />
                <Kpi label="Net cash" value={inr(cash?.net ?? 0)} hint="cash in − cash out" tone={(cash?.net ?? 0) < 0 ? "bad" : undefined} />
                <Kpi k="credit_sales" value={inr(pr.udhaar_given)} hint="not money; on khata" />
              </div>
              {pr.by_method.length === 0 ? <NoData title="No money in or out in these dates" /> : (
                <>
                  <div className="grid gap-4 2xl:grid-cols-2">
                    <Section title="By method" description="Split bills count each part under its own method. Udhaar is not money and is left out."
                      csv={{ filename: csvName(ctx, "payments-by-method"), meta: csvMeta(ctx, "Payments by method", ["Whole period; filters below the table don't apply here"]),
                        rows: pr.by_method.map((m) => ({ method: methodLabel(m.key), money_in: m.money_in, money_out: m.money_out, net: m.net, entries: m.entries })) }}>
                      <Table>
                        <TableHeader><TableRow><TableHead>Method</TableHead><TableHead className={R}>In</TableHead><TableHead className={R}>Out</TableHead><TableHead className={R}>Net</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {pr.by_method.map((m) => (
                            <TableRow key={m.key} className="cursor-pointer" onClick={() => setMethod(m.key)}>
                              <TableCell>{methodLabel(m.key)}<div className="text-xs text-muted-foreground">{plural(m.entries, "entry", "entries")}</div></TableCell>
                              <TableCell className={R}>{inr(m.money_in, 2)}</TableCell><TableCell className={R}>{m.money_out ? inr(m.money_out, 2) : "—"}</TableCell>
                              <TableCell className={`${R} font-medium ${m.net < 0 ? "text-destructive" : ""}`}>{inr(m.net, 2)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                        <TableFooter><TableRow><TableCell>Total</TableCell><TableCell className={R}>{inr(tin, 2)}</TableCell><TableCell className={R}>{inr(tout, 2)}</TableCell><TableCell className={R}>{inr(tin - tout, 2)}</TableCell></TableRow></TableFooter>
                      </Table>
                    </Section>
                    <Section title="By type" description={pr.khata_refunds ? `Returns refunded to khata (${inr(pr.khata_refunds, 2)}) are not money and are left out.` : "Money in is positive, money out negative."}>
                      <Table>
                        <TableHeader><TableRow><TableHead>Type</TableHead><TableHead className={R}>Entries</TableHead><TableHead className={R}>Amount</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {pr.by_kind.map((k) => (
                            <TableRow key={k.key} className="cursor-pointer" onClick={() => setKind(k.key)}>
                              <TableCell>{KIND_NAMES[k.key] ?? k.key}</TableCell><TableCell className={R}>{num(k.entries)}</TableCell>
                              <TableCell className={`${R} ${k.amount < 0 ? "text-destructive" : "text-success"}`}>{inr(k.amount, 2)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Section>
                  </div>
                  {chart.length > 1 && (
                    <Section title="Day by day" description="Money in and out each day, all methods.">
                      <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={chart}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={12} />
                          <YAxis tickFormatter={(v) => inrShort(Number(v))} width={60} />
                          <Tooltip formatter={(v, name) => [inr(Number(v)), name]} /><Legend />
                          <Bar dataKey="money_in" name="Money in" fill="hsl(var(--success))" radius={[3, 3, 0, 0]} />
                          <Bar dataKey="money_out" name="Money out" fill="hsl(var(--destructive))" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </Section>
                  )}
                  <Section title="Entries" description="Newest first. Tap a method or type above to filter."
                    actions={(method !== "all" || kind !== "all") ? <Button size="sm" variant="ghost" className="h-8" onClick={() => { setMethod("all"); setKind("all"); }}>Show all</Button> : undefined}
                    csv={{ filename: csvName(ctx, "payment-register"), meta: csvMeta(ctx, "Payment register", [`Method: ${method === "all" ? "All" : methodLabel(method)}`, `Type: ${kind === "all" ? "All" : KIND_NAMES[kind]}`, `Rows ${page * size + 1} to ${page * size + pr.rows.length} of ${pr.total}`, ...(q ? [`Search: ${q}`] : [])]),
                      rows: pr.rows.map((r) => ({ when: r.at, type: KIND_NAMES[r.kind] ?? r.kind, method: methodLabel(r.method), amount: r.amount, reference: r.ref ?? "", party: r.party ?? "", by: r.by_name ?? "" })), all: allPages((limit, offset) => reportPaymentRegister(ctx.range.from, ctx.range.to, ctx.storeId, { method: method === "all" ? null : method, kind: kind === "all" ? null : kind, search: q || null, limit, offset }), (r) => ({ when: r.at, type: KIND_NAMES[r.kind] ?? r.kind, method: methodLabel(r.method), amount: r.amount, reference: r.ref ?? "", party: r.party ?? "", by: r.by_name ?? "" })) }}>
                    {pr.total === 0 ? <p className="text-sm text-muted-foreground py-4">Nothing matches these filters.</p> : (
                      <>
                        <Table>
                          <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Type</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead><TableHead className={R}>Amount</TableHead><TableHead>By</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {pr.rows.map((r, i) => (
                              <TableRow key={`${r.ref_id}-${r.method}-${i}`}>
                                <TableCell className="whitespace-nowrap text-xs">{dateTime(r.at)}</TableCell>
                                <TableCell className="text-sm">{KIND_NAMES[r.kind] ?? r.kind}</TableCell>
                                <TableCell>{methodLabel(r.method)}</TableCell>
                                <TableCell className="min-w-[120px]"><div className="text-sm">{r.ref || "—"}</div>{r.party && <div className="text-xs text-muted-foreground">{r.party}</div>}</TableCell>
                                <TableCell className={`${R} font-medium whitespace-nowrap ${r.amount < 0 ? "text-destructive" : "text-success"}`}>{r.amount < 0 ? "−" : "+"}{inr(Math.abs(r.amount), 2)}</TableCell>
                                <TableCell className="text-xs">{r.by_name || "—"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        <Pager page={page} size={size} total={pr.total} setPage={setPage} setSize={setSize} />
                      </>
                    )}
                  </Section>
                </>
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

// ---------------------------------------------------------------- registers (day closing)
const diffText = (d: number | null) => (d === null ? "—" : Math.abs(d) < 0.005 ? "exact" : d < 0 ? `short ${inr(-d, 2)}` : `over ${inr(d, 2)}`);
const diffClass = (d: number | null) => (d === null || Math.abs(d) < 0.005 ? "text-muted-foreground" : d < 0 ? "text-destructive font-medium" : "text-warning-foreground font-medium");

export function RegisterVariance({ ctx }: { ctx: ReportCtx }) {
  const [missing, onMissing] = useMissing();
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  useEffect(() => { setPage(0); }, [ctx.run, ctx.storeId]);
  const state = useReportData(() => reportRegisters(ctx.range.from, ctx.range.to, ctx.storeId, { limit: size, offset: page * size }),
    [ctx.run, ctx.storeId, page, size], onMissing);
  if (missing) return <NeedsUpdate />;

  return (
    <Loaded state={state} kpis={4}>
      {(rg) => {
        const t = rg.totals;
        if (t.sessions === 0) return <NoData title="No register sessions in these dates" description="Sessions are counted on the day the register was opened (Day closing page)." />;
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi label="Sessions" value={num(t.sessions)} hint={t.open ? `${t.open} still open` : `${t.exact_count} exact`} />
              <Kpi label="Cash short" value={inr(t.short, 2)} hint={plural(t.short_count, "session")} tone={t.short > 0 ? "bad" : undefined} />
              <Kpi label="Cash over" value={inr(t.over, 2)} hint={plural(t.over_count, "session")} />
              <Kpi label="Net difference" value={inr(t.net, 2)} hint={`counted ${inr(t.counted_cash)} of ${inr(t.expected_cash)}`} tone={t.net < 0 ? "bad" : undefined} />
            </div>
            {rg.by_cashier.length > 0 && (
              <Section title="By staff member" description="Cash difference at closing: counted minus expected."
                csv={{ filename: csvName(ctx, "register-variance-by-staff"), meta: csvMeta(ctx, "Register variance by staff"),
                  rows: rg.by_cashier.map((c) => ({ staff: c.label, sessions: c.sessions, short: c.short, short_sessions: c.short_count, over: c.over, net: c.net })) }}>
                <Table>
                  <TableHeader><TableRow><TableHead>Staff</TableHead><TableHead className={R}>Sessions</TableHead><TableHead className={R}>Short</TableHead><TableHead className={R}>Over</TableHead><TableHead className={R}>Net</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {rg.by_cashier.map((c) => (
                      <TableRow key={c.key}>
                        <TableCell>{c.label === "Unknown" ? "Unnamed staff" : c.label}</TableCell><TableCell className={R}>{num(c.sessions)}</TableCell>
                        <TableCell className={`${R} ${c.short > 0 ? "text-destructive" : ""}`}>{c.short ? `${inr(c.short, 2)} (${c.short_count})` : "—"}</TableCell>
                        <TableCell className={R}>{c.over ? inr(c.over, 2) : "—"}</TableCell>
                        <TableCell className={`${R} ${diffClass(c.net)}`}>{inr(c.net, 2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Section>
            )}
            <Section title="Sessions" description="Expected cash = opening cash + cash sales + cash khata payments − cash refunds, supplier and expense payments from the till. UPI and card are shown where they were counted at closing."
              csv={{ filename: csvName(ctx, "register-sessions"), meta: csvMeta(ctx, "Register sessions", [`Rows ${page * size + 1} to ${page * size + rg.rows.length} of ${rg.total}`]),
                rows: rg.rows.map((r) => ({ staff: r.cashier ?? "", opened: r.opened_at, closed: r.closed_at ?? "open", opening_cash: r.opening_cash, bills: r.bills ?? "", sales: r.total_sales ?? "",
                  expected_cash: r.expected_cash ?? "", counted_cash: r.counted_cash ?? "", cash_difference: r.difference ?? "",
                  upi_expected: r.upi_expected ?? "", upi_counted: r.upi_counted ?? "", upi_difference: r.upi_diff ?? "",
                  card_expected: r.card_expected ?? "", card_counted: r.card_counted ?? "", card_difference: r.card_diff ?? "", note: r.note ?? "" })), all: allPages((limit, offset) => reportRegisters(ctx.range.from, ctx.range.to, ctx.storeId, { limit, offset }), (r) => ({ staff: r.cashier ?? "", opened: r.opened_at, closed: r.closed_at ?? "open", opening_cash: r.opening_cash, bills: r.bills ?? "", sales: r.total_sales ?? "",
                  expected_cash: r.expected_cash ?? "", counted_cash: r.counted_cash ?? "", cash_difference: r.difference ?? "",
                  upi_expected: r.upi_expected ?? "", upi_counted: r.upi_counted ?? "", upi_difference: r.upi_diff ?? "",
                  card_expected: r.card_expected ?? "", card_counted: r.card_counted ?? "", card_difference: r.card_diff ?? "", note: r.note ?? "" })) }}>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Staff</TableHead><TableHead>Opened – closed</TableHead><TableHead className={R}>Sales</TableHead>
                  <TableHead className={R}>Expected cash</TableHead><TableHead className={R}>Counted</TableHead><TableHead className={R}>Cash</TableHead><TableHead className={R}>UPI</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {rg.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.cashier || "—"}{r.note && <div className="text-xs text-muted-foreground max-w-[180px] truncate" title={r.note}>{r.note}</div>}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{dateTime(r.opened_at)}<div className="text-muted-foreground">{r.closed_at ? dateTime(r.closed_at) : <Badge variant="outline">still open</Badge>}</div></TableCell>
                      <TableCell className={R}>{r.total_sales === null ? "—" : inr(r.total_sales)}{r.bills !== null && <div className="text-xs text-muted-foreground">{plural(r.bills, "bill")}</div>}</TableCell>
                      <TableCell className={R}>{r.expected_cash === null ? "—" : inr(r.expected_cash, 2)}</TableCell>
                      <TableCell className={R}>{r.counted_cash === null ? "—" : inr(r.counted_cash, 2)}</TableCell>
                      <TableCell className={`${R} whitespace-nowrap ${diffClass(r.difference)}`}>{r.closed_at ? diffText(r.difference) : "—"}</TableCell>
                      <TableCell className={`${R} whitespace-nowrap ${diffClass(r.upi_diff)}`}>{r.upi_counted === null ? "—" : diffText(r.upi_diff)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pager page={page} size={size} total={rg.total} setPage={setPage} setSize={setSize} />
            </Section>
          </div>
        );
      }}
    </Loaded>
  );
}
