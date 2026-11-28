// GST working summary and staff performance (Phase 6). Figures come from
// report_gst / report_staff. The GST summary is a working view for the owner
// and the accountant, not a GST return: the GST reports page has the
// GSTR-1 / 3B workings.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Info, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { inrShort } from "@/lib/dashboard";
import { GstRateRow, StaffRow, reportGst, reportStaff } from "@/lib/reports/api";
import { ReportCtx, csvMeta, csvName, useReportData } from "./context";
import { CHART_COLORS, Kpi, Loaded, NoData, Section, fmtBucket, inr, num } from "./shared";
import { NeedsUpdate as Needs, useMissing } from "./missing";

const R = "text-right";
const NeedsUpdate = () => <Needs file="phase6-reports-gst-staff.sql" />;
const rate = (r: number) => `${Number.isInteger(r) ? r : r.toFixed(2)}%`;
const plural = (n: number, one: string, many = one + "s") => `${num(n)} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- GST summary
function RateTable({ rows, label }: { rows: GstRateRow[]; label: string }) {
  const sum = (k: keyof GstRateRow) => rows.reduce((a, r) => a + (r[k] as number), 0);
  return (
    <Table>
      <TableHeader><TableRow>
        <TableHead>GST rate</TableHead><TableHead className={R}>Taxable value</TableHead><TableHead className={R}>CGST</TableHead>
        <TableHead className={R}>SGST</TableHead><TableHead className={R}>IGST</TableHead><TableHead className={R}>{label}</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.rate}>
            <TableCell>{rate(r.rate)}</TableCell><TableCell className={R}>{inr(r.taxable, 2)}</TableCell>
            <TableCell className={R}>{inr(r.cgst, 2)}</TableCell><TableCell className={R}>{inr(r.sgst, 2)}</TableCell>
            <TableCell className={R}>{inr(r.igst, 2)}</TableCell><TableCell className={`${R} font-medium`}>{inr(r.tax, 2)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter><TableRow>
        <TableCell>Total</TableCell><TableCell className={R}>{inr(sum("taxable"), 2)}</TableCell><TableCell className={R}>{inr(sum("cgst"), 2)}</TableCell>
        <TableCell className={R}>{inr(sum("sgst"), 2)}</TableCell><TableCell className={R}>{inr(sum("igst"), 2)}</TableCell><TableCell className={R}>{inr(sum("tax"), 2)}</TableCell>
      </TableRow></TableFooter>
    </Table>
  );
}

const rateCsv = (rows: GstRateRow[]) => rows.map((r) => ({ gst_rate_pct: r.rate, taxable_value: r.taxable, cgst: r.cgst, sgst: r.sgst, igst: r.igst, total_gst: r.tax }));

export function GstSummary({ ctx }: { ctx: ReportCtx }) {
  const [missing, onMissing] = useMissing();
  const state = useReportData(() => reportGst(ctx.range.from, ctx.range.to, ctx.storeId), [ctx.run, ctx.storeId], onMissing);
  if (missing) return <NeedsUpdate />;

  return (
    <Loaded state={state} kpis={4}>
      {(g) => {
        const o = g.output, i = g.input, c = g.checks;
        if (o.sales_taxable === 0 && o.credit_notes_taxable === 0 && i.purchases_taxable === 0 && i.returns_taxable === 0)
          return <NoData title="No bills or supplier bills in these dates" description="GST is worked out from your sale bills, returns, supplier bills and returns to suppliers." />;
        const warnings = [
          c.no_hsn_lines > 0 && `${plural(c.no_hsn_lines, "bill line")} (${inr(c.no_hsn_value)} taxable) have no HSN code. Add HSN codes on the Products page.`,
          c.input_without_gstin_tax > 0 && `${inr(c.input_without_gstin_tax, 2)} of input GST is on bills from suppliers with no GSTIN saved. Input credit usually needs the supplier's GSTIN.`,
          c.purchases_without_store_state > 0 && `Your store's state code isn't set, so input GST on ${plural(c.purchases_without_store_state, "purchase line")} is split as CGST + SGST. Set it in Settings.`,
        ].filter(Boolean) as string[];
        return (
          <div className="space-y-4">
            <Card className="border-dashed">
              <CardContent className="py-3 text-sm flex gap-2 items-start">
                <Info className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <div>
                  A working summary from the bills in the app, to check figures with your accountant. It is <b>not a GST return</b> and is not ready to file as it is.
                  Input credit you can actually claim depends on GSTR-2B and the rules. For the GSTR-1 and 3B workings, open the{" "}
                  <Link to="/gst" className="underline underline-offset-2">GST reports page</Link>.
                </div>
              </CardContent>
            </Card>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi k="output_gst" value={inr(o.tax, 2)} hint={`on ${inr(o.taxable)} taxable, after credit notes`} />
              <Kpi k="input_gst" value={inr(i.tax, 2)} hint={`on ${inr(i.taxable)} of supplier bills`} />
              <Kpi k="net_gst" label="Net GST" value={inr(g.net.tax, 2)} hint={g.net.tax < 0 ? "more input than output" : "output minus input"} tone={g.net.tax < 0 ? "good" : undefined} />
              <Kpi label="Credit notes" value={inr(o.credit_notes_tax, 2)} hint={`GST on ${inr(o.credit_notes_taxable)} of returns`} />
            </div>
            {warnings.length > 0 && (
              <Card className="border-warning/50">
                <CardContent className="py-3 text-sm space-y-1.5">
                  {warnings.map((w) => <div key={w} className="flex gap-2 items-start"><TriangleAlert className="h-4 w-4 mt-0.5 shrink-0 text-warning" />{w}</div>)}
                </CardContent>
              </Card>
            )}
            <Section title="Output and input" description="CGST and SGST for sales within the state, IGST for interstate bills. Purchases are IGST when the supplier's state (or GSTIN) differs from your store's."
              csv={{ filename: csvName(ctx, "gst-summary"), meta: csvMeta(ctx, "GST summary (working, not a return)"),
                rows: [
                  { line: "Sales", taxable_value: o.sales_taxable, total_gst: o.sales_tax },
                  { line: "Less credit notes (returns)", taxable_value: -o.credit_notes_taxable, total_gst: -o.credit_notes_tax },
                  { line: "Output", taxable_value: o.taxable, cgst: o.cgst, sgst: o.sgst, igst: o.igst, total_gst: o.tax },
                  { line: "Output B2B (customer has GSTIN)", taxable_value: o.b2b_taxable, total_gst: o.b2b_tax },
                  { line: "Output B2C", taxable_value: o.b2c_taxable, total_gst: o.b2c_tax },
                  { line: "Supplier bills", taxable_value: i.purchases_taxable, total_gst: i.purchases_tax },
                  { line: "Less returns to suppliers", taxable_value: -i.returns_taxable, total_gst: -i.returns_tax },
                  { line: "Input", taxable_value: i.taxable, cgst: i.cgst, sgst: i.sgst, igst: i.igst, total_gst: i.tax },
                  { line: "Net (indicative)", cgst: g.net.cgst, sgst: g.net.sgst, igst: g.net.igst, total_gst: g.net.tax },
                ] }}>
              <Table>
                <TableHeader><TableRow>
                  <TableHead /><TableHead className={R}>Taxable value</TableHead><TableHead className={R}>CGST</TableHead>
                  <TableHead className={R}>SGST</TableHead><TableHead className={R}>IGST</TableHead><TableHead className={R}>Total GST</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  <TableRow><TableCell className="min-w-[150px]">Sales<div className="text-xs text-muted-foreground">less {inr(o.credit_notes_tax, 2)} on credit notes</div></TableCell>
                    <TableCell className={R}>{inr(o.taxable, 2)}</TableCell><TableCell className={R}>{inr(o.cgst, 2)}</TableCell><TableCell className={R}>{inr(o.sgst, 2)}</TableCell>
                    <TableCell className={R}>{inr(o.igst, 2)}</TableCell><TableCell className={`${R} font-medium`}>{inr(o.tax, 2)}</TableCell></TableRow>
                  <TableRow><TableCell>Supplier bills<div className="text-xs text-muted-foreground">less {inr(i.returns_tax, 2)} on returns</div></TableCell>
                    <TableCell className={R}>{inr(i.taxable, 2)}</TableCell><TableCell className={R}>{inr(i.cgst, 2)}</TableCell><TableCell className={R}>{inr(i.sgst, 2)}</TableCell>
                    <TableCell className={R}>{inr(i.igst, 2)}</TableCell><TableCell className={`${R} font-medium`}>{inr(i.tax, 2)}</TableCell></TableRow>
                </TableBody>
                <TableFooter><TableRow>
                  <TableCell>Net (indicative)</TableCell><TableCell />
                  <TableCell className={R}>{inr(g.net.cgst, 2)}</TableCell><TableCell className={R}>{inr(g.net.sgst, 2)}</TableCell>
                  <TableCell className={R}>{inr(g.net.igst, 2)}</TableCell><TableCell className={R}>{inr(g.net.tax, 2)}</TableCell>
                </TableRow></TableFooter>
              </Table>
              <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
                <div className="rounded-md border p-3"><div className="text-muted-foreground text-xs">B2B (customer has GSTIN)</div>{inr(o.b2b_taxable)} taxable · {inr(o.b2b_tax, 2)} GST</div>
                <div className="rounded-md border p-3"><div className="text-muted-foreground text-xs">B2C</div>{inr(o.b2c_taxable)} taxable · {inr(o.b2c_tax, 2)} GST</div>
              </div>
            </Section>
            {g.by_month.length > 1 && (
              <Section title="Month by month" description="Output and input GST in each month of the dates.">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={g.by_month.map((m) => ({ ...m, label: fmtBucket(m.bucket, "month") }))}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" fontSize={12} /><YAxis fontSize={12} tickFormatter={(v) => inrShort(v)} width={56} />
                      <Tooltip formatter={(v: number) => inr(v, 2)} />
                      <Legend />
                      <Bar dataKey="output_tax" name="Output GST" fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="input_tax" name="Input GST" fill={CHART_COLORS[1]} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Section>
            )}
            <div className="grid gap-4 2xl:grid-cols-2">
              <Section title="Output GST by rate" description="Sales less credit notes."
                csv={{ filename: csvName(ctx, "gst-output-by-rate"), meta: csvMeta(ctx, "Output GST by rate"), rows: rateCsv(g.output_by_rate) }}>
                <RateTable rows={g.output_by_rate} label="Output GST" />
              </Section>
              <Section title="Input GST by rate" description="Supplier bills less returns to suppliers."
                csv={{ filename: csvName(ctx, "gst-input-by-rate"), meta: csvMeta(ctx, "Input GST by rate"), rows: rateCsv(g.input_by_rate) }}>
                {g.input_by_rate.length ? <RateTable rows={g.input_by_rate} label="Input GST" /> : <p className="text-sm text-muted-foreground">No supplier bills in these dates.</p>}
              </Section>
            </div>
            <Section title="HSN-wise outward summary" description="Sales less credit notes, by HSN code and rate. Lines with no HSN code are grouped as “No HSN”."
              csv={{ filename: csvName(ctx, "gst-hsn-summary"), meta: csvMeta(ctx, "HSN-wise outward summary"),
                rows: g.hsn.map((h) => ({ hsn: h.hsn, description: h.description ?? "", gst_rate_pct: h.rate, quantity: h.qty, taxable_value: h.taxable, cgst: h.cgst, sgst: h.sgst, igst: h.igst, total_gst: h.tax })) }}>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>HSN</TableHead><TableHead className="min-w-[140px]">Example item</TableHead><TableHead className={R}>Rate</TableHead><TableHead className={R}>Qty</TableHead>
                  <TableHead className={R}>Taxable value</TableHead><TableHead className={R}>GST</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {g.hsn.map((h) => (
                    <TableRow key={`${h.hsn}-${h.rate}`}>
                      <TableCell className="whitespace-nowrap">{h.hsn || <Badge variant="outline" className="text-warning border-warning/50">No HSN</Badge>}</TableCell>
                      <TableCell className="text-sm">{h.description ?? "—"}</TableCell><TableCell className={R}>{rate(h.rate)}</TableCell>
                      <TableCell className={R}>{num(h.qty)}</TableCell><TableCell className={R}>{inr(h.taxable, 2)}</TableCell>
                      <TableCell className={R}>{inr(h.tax, 2)}<div className="text-xs text-muted-foreground whitespace-nowrap">{h.igst ? `IGST ${inr(h.igst, 2)}` : `C+S ${inr(h.cgst, 2)} + ${inr(h.sgst, 2)}`}</div></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>
          </div>
        );
      }}
    </Loaded>
  );
}

// ---------------------------------------------------------------- Staff performance
const STAFF_SORTS: { key: keyof StaffRow; label: string; asc?: boolean }[] = [
  { key: "net_sales", label: "Net sales" }, { key: "bills", label: "Bills" }, { key: "avg_bill", label: "Average bill" },
  { key: "discount_pct", label: "Discount %" }, { key: "cash_short", label: "Cash short" }, { key: "sales_per_hour", label: "Sales per hour" },
  { key: "late_minutes", label: "Late minutes" }, { key: "name", label: "Name", asc: true },
];

export function StaffPerformance({ ctx }: { ctx: ReportCtx }) {
  const [missing, onMissing] = useMissing();
  const [sort, setSort] = useState<keyof StaffRow>("net_sales");
  const [chart, setChart] = useState<"net_sales" | "bills">("net_sales");
  const state = useReportData(() => reportStaff(ctx.range.from, ctx.range.to, ctx.storeId), [ctx.run, ctx.storeId], onMissing);
  if (missing) return <NeedsUpdate />;

  return (
    <Loaded state={state} kpis={4}>
      {(st) => {
        const t = st.totals;
        if (!st.rows.length) return <NoData title="No staff activity in these dates" description="Bills, returns, khata payments, register sessions and attendance are counted here." />;
        const asc = STAFF_SORTS.find((s) => s.key === sort)?.asc;
        const rows = [...st.rows].sort((a, b) => {
          const x = a[sort], y = b[sort];
          if (typeof x === "string" || typeof y === "string") return String(x ?? "").localeCompare(String(y ?? ""));
          return asc ? (Number(x ?? 0) - Number(y ?? 0)) : (Number(y ?? -Infinity) - Number(x ?? -Infinity));
        });
        const billers = st.rows.filter((r) => r.bills > 0);
        const hasAttendance = st.rows.some((r) => r.present !== null);
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi k="staff_net_sales" label="Net sales" value={inr(t.net_sales)} hint={`${plural(t.bills, "bill")} by ${plural(billers.length, "person", "people")}`} />
              <Kpi label="Discounts given" value={inr(t.discounts, 2)} hint="on bills, before GST" />
              <Kpi label="Returns handled" value={inr(t.returns_value, 2)} hint="value before GST" />
              <Kpi label="Cash short" value={inr(t.cash_short, 2)} tone={t.cash_short > 0 ? "bad" : undefined} hint={`khata collected ${inr(t.khata_collected)}`} />
            </div>
            {billers.length > 0 && (
              <Section title="Who billed what" description="Net sales = sales before GST less returns that person handled."
                actions={
                  <div className="flex gap-1">
                    <Button size="sm" variant={chart === "net_sales" ? "secondary" : "ghost"} onClick={() => setChart("net_sales")}>Sales</Button>
                    <Button size="sm" variant={chart === "bills" ? "secondary" : "ghost"} onClick={() => setChart("bills")}>Bills</Button>
                  </div>
                }>
                <div style={{ height: Math.max(160, billers.length * 40 + 40) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={billers} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" fontSize={12} tickFormatter={(v) => (chart === "bills" ? String(v) : inrShort(v))} />
                      <YAxis type="category" dataKey="name" fontSize={12} width={100} />
                      <Tooltip formatter={(v: number) => (chart === "bills" ? num(v) : inr(v))} />
                      <Bar dataKey={chart} name={chart === "bills" ? "Bills" : "Net sales"} fill={CHART_COLORS[0]} radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Section>
            )}
            <Section title="By staff member"
              description="Bills they made, discounts they gave, returns they took and khata payments they received."
              actions={
                <Select value={sort} onValueChange={(v) => setSort(v as keyof StaffRow)}>
                  <SelectTrigger className="h-8 w-[150px]" aria-label="Sort by"><SelectValue /></SelectTrigger>
                  <SelectContent>{STAFF_SORTS.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              }
              csv={{ filename: csvName(ctx, "staff-performance"), meta: csvMeta(ctx, "Staff performance"),
                rows: rows.map((r) => ({ staff: r.name, job_title: r.job_title ?? "", has_login: r.login ? "yes" : "no", bills: r.bills, billed_incl_gst: r.billed,
                  sales_before_discount: r.gross_sales, discounts: r.discounts, discount_pct: r.discount_pct ?? "", discounted_bills: r.discounted_bills,
                  returns: r.returns_count, returns_value: r.returns_value, net_sales: r.net_sales, avg_bill: r.avg_bill ?? "", items_per_bill: r.units_per_bill ?? "",
                  khata_payments: r.khata_count, khata_collected: r.khata_collected, register_sessions: r.sessions, register_hours: r.register_hours,
                  sales_per_hour: r.sales_per_hour ?? "", cash_short: r.cash_short, short_sessions: r.short_count, cash_net_difference: r.cash_net_diff,
                  discount_approvals_asked: r.discount_approvals, present: r.present ?? "", half_days: r.half_days ?? "", absent: r.absent ?? "", paid_leave: r.leave ?? "",
                  late_days: r.late_days ?? "", late_minutes: r.late_minutes ?? "" })) }}>
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="min-w-[130px]">Staff</TableHead><TableHead className={R}>Bills</TableHead><TableHead className={R}>Net sales</TableHead>
                  <TableHead className={R}>Discounts</TableHead><TableHead className={R}>Returns</TableHead>
                  <TableHead className={R}>Khata</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.user_id ?? `staff-${r.name}`}>
                      <TableCell>{r.name}<div className="text-xs text-muted-foreground">{[r.job_title, !r.login && "no app login"].filter(Boolean).join(" · ") || " "}</div></TableCell>
                      <TableCell className={R}>{r.bills ? num(r.bills) : "—"}{r.units_per_bill !== null && <div className="text-xs text-muted-foreground whitespace-nowrap">{r.units_per_bill} items/bill</div>}</TableCell>
                      <TableCell className={R}>{r.bills || r.returns_count ? inr(r.net_sales) : "—"}{r.avg_bill !== null && <div className="text-xs text-muted-foreground whitespace-nowrap">avg {inr(r.avg_bill)}</div>}</TableCell>
                      <TableCell className={R}>{r.discounts ? inr(r.discounts, 2) : "—"}{r.discount_pct ? <div className="text-xs text-muted-foreground whitespace-nowrap">{r.discount_pct}% · {plural(r.discounted_bills, "bill")}</div> : null}</TableCell>
                      <TableCell className={R}>{r.returns_count ? <>{inr(r.returns_value)}<div className="text-xs text-muted-foreground">{plural(r.returns_count, "return")}</div></> : "—"}</TableCell>
                      <TableCell className={R}>{r.khata_count ? <>{inr(r.khata_collected)}<div className="text-xs text-muted-foreground">{plural(r.khata_count, "payment")}</div></> : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>
            <Section title="Register and attendance"
              description="Hours = time the register was open in their name. Sales per hour shows when they had at least 15 minutes on the register. Attendance is from the Staff page.">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="min-w-[130px]">Staff</TableHead><TableHead className={R}>Register hours</TableHead><TableHead className={R}>Sales per hour</TableHead>
                  <TableHead className={R}>Cash short</TableHead>
                  {hasAttendance && <><TableHead className={R}>Attendance</TableHead><TableHead className={R}>Late</TableHead></>}
                </TableRow></TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.user_id ?? `staff-${r.name}`}>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className={R}>{r.sessions ? <>{r.register_hours} h<div className="text-xs text-muted-foreground">{plural(r.sessions, "session")}</div></> : "—"}</TableCell>
                      <TableCell className={R}>{r.sales_per_hour === null ? "—" : inr(r.sales_per_hour)}</TableCell>
                      <TableCell className={`${R} ${r.cash_short > 0 ? "text-destructive" : ""}`}>{r.sessions ? (r.cash_short > 0 ? <>{inr(r.cash_short, 2)}<div className="text-xs">{plural(r.short_count, "session")}</div></> : "none") : "—"}</TableCell>
                      {hasAttendance && <>
                        <TableCell className={`${R} whitespace-nowrap text-sm`}>
                          {r.present === null ? "—" : <>{num(r.present)} P{r.half_days ? ` · ${r.half_days} ½` : ""}{r.absent ? ` · ${r.absent} A` : ""}{r.leave ? ` · ${r.leave} L` : ""}</>}
                        </TableCell>
                        <TableCell className={`${R} whitespace-nowrap ${r.late_minutes ? "text-warning" : ""}`}>{r.late_minutes ? <>{r.late_minutes} min<div className="text-xs">{plural(r.late_days ?? 0, "day")}</div></> : r.present === null ? "—" : "on time"}</TableCell>
                      </>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {hasAttendance && <p className="text-xs text-muted-foreground mt-2">P present, ½ half day, A absent, L paid leave.</p>}
            </Section>
          </div>
        );
      }}
    </Loaded>
  );
}
