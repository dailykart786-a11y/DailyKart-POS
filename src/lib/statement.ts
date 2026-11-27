// Customer and supplier ledgers: one list of entries with a running balance,
// and a printable statement for any date range.
import { supabase } from "@/integrations/supabase/client";

export interface LedgerEntry {
  id: string;
  at: string;
  kind: "opening" | "sale" | "payment" | "return" | "purchase";
  label: string;
  debit: number;   // adds to what is owed
  credit: number;  // reduces what is owed
  reversed?: { at: string; reason: string | null } | null;
  paymentId?: string;
}
export interface LedgerRow extends LedgerEntry { running: number; }

const r2 = (n: number) => Math.round(n * 100) / 100;
export const rupees = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const METHOD: Record<string, string> = { cash: "cash", upi: "UPI", card: "card", bank: "bank transfer", cheque: "cheque" };

/** Oldest first, with the running balance. Reversed payments count for nothing. */
export function withRunning(entries: LedgerEntry[]): LedgerRow[] {
  let running = 0;
  return [...entries]
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || (a.kind === "opening" ? -1 : b.kind === "opening" ? 1 : 0))
    .map((e) => {
      if (!e.reversed) running = r2(running + e.debit - e.credit);
      return { ...e, running };
    });
}

/** Everything that changed what a customer owes. Works on older databases too. */
export async function customerLedger(customerId: string, opening = 0, openingAt?: string | null): Promise<LedgerEntry[]> {
  let sales: any = await supabase.from("sales")
    .select("id, invoice_number, total_amount, created_at, status, payment_method, credit_amount" as any)
    .eq("customer_id", customerId).or("payment_method.eq.credit,credit_amount.gt.0").order("created_at", { ascending: true });
  if (sales.error) {
    sales = await supabase.from("sales").select("id, invoice_number, total_amount, created_at, status, payment_method")
      .eq("customer_id", customerId).eq("payment_method", "credit").order("created_at", { ascending: true });
  }
  let pays: any = await supabase.from("customer_payments" as any)
    .select("id, amount, method, note, created_at, reversed_at, reversal_reason")
    .eq("customer_id", customerId).order("created_at", { ascending: true });
  if (pays.error) {
    pays = await supabase.from("customer_payments" as any).select("id, amount, method, note, created_at")
      .eq("customer_id", customerId).order("created_at", { ascending: true });
  }
  const rets: any = await supabase.from("sale_returns" as any)
    .select("id, return_number, refund_amount, created_at, refund_method")
    .eq("customer_id", customerId).eq("refund_method", "khata");

  const out: LedgerEntry[] = [];
  if (opening) {
    out.push({ id: "opening", at: openingAt || "2000-01-01T00:00:00Z", kind: "opening", label: "Opening balance",
      debit: opening > 0 ? opening : 0, credit: opening < 0 ? -opening : 0 });
  }
  for (const s of (sales.data || []) as any[]) {
    if ((s.status || "completed") === "cancelled") continue;
    const amt = s.credit_amount != null ? Number(s.credit_amount) : s.payment_method === "credit" ? Number(s.total_amount) : 0;
    if (amt <= 0) continue;
    const part = s.payment_method !== "credit" ? ` (udhaar part of ${rupees(Number(s.total_amount))})` : "";
    out.push({ id: s.id, at: s.created_at, kind: "sale", label: `Bill ${s.invoice_number}${part}`, debit: amt, credit: 0 });
  }
  for (const p of (pays.data || []) as any[]) {
    out.push({
      id: p.id, paymentId: p.id, at: p.created_at, kind: "payment",
      label: `Paid by ${METHOD[p.method] || p.method}${p.note ? ` (${p.note})` : ""}`,
      debit: 0, credit: Number(p.amount),
      reversed: p.reversed_at ? { at: p.reversed_at, reason: p.reversal_reason || null } : null,
    });
  }
  if (!rets.error) {
    for (const r of (rets.data || []) as any[]) {
      out.push({ id: r.id, at: r.created_at, kind: "return", label: `Return ${r.return_number || ""}`.trim(), debit: 0, credit: Number(r.refund_amount) });
    }
  }
  return out;
}

/** Everything that changed what the shop owes a supplier. */
export async function supplierLedger(supplierId: string, opening = 0, openingAt?: string | null): Promise<LedgerEntry[]> {
  const pur: any = await supabase.from("purchases" as any)
    .select("id, bill_number, bill_date, total_amount, created_at").eq("supplier_id", supplierId);
  let pays: any = await supabase.from("supplier_payments" as any)
    .select("id, amount, method, note, created_at, reversed_at, reversal_reason").eq("supplier_id", supplierId);
  if (pays.error) pays = await supabase.from("supplier_payments" as any).select("id, amount, method, note, created_at").eq("supplier_id", supplierId);
  const out: LedgerEntry[] = [];
  if (opening) {
    out.push({ id: "opening", at: openingAt || "2000-01-01T00:00:00Z", kind: "opening", label: "Opening balance",
      debit: opening > 0 ? opening : 0, credit: opening < 0 ? -opening : 0 });
  }
  for (const p of (pur.data || []) as any[]) {
    out.push({ id: p.id, at: p.created_at, kind: "purchase", label: `Bill ${p.bill_number || "-"} (${p.bill_date || ""})`, debit: Number(p.total_amount), credit: 0 });
  }
  for (const p of (pays.data || []) as any[]) {
    out.push({
      id: p.id, paymentId: p.id, at: p.created_at, kind: "payment",
      label: `Paid by ${METHOD[p.method] || p.method}${p.note ? ` (${p.note})` : ""}`,
      debit: 0, credit: Number(p.amount),
      reversed: p.reversed_at ? { at: p.reversed_at, reason: p.reversal_reason || null } : null,
    });
  }
  return out;
}

/** Due date and days overdue from the oldest unpaid bill and the credit days. */
export function dueInfo(oldestDueAt: string | null | undefined, creditDays: number | null | undefined) {
  if (!oldestDueAt || creditDays == null) return null;
  const due = new Date(new Date(oldestDueAt).getTime() + Number(creditDays) * 86400000);
  const overdueDays = Math.floor((Date.now() - due.getTime()) / 86400000);
  return { due, overdueDays };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/** Statement for a date range (YYYY-MM-DD, India time): balance brought forward, entries, closing balance. */
export function statementRows(entries: LedgerEntry[], from: string, to: string) {
  const start = new Date(`${from}T00:00:00+05:30`).getTime();
  const end = new Date(`${to}T00:00:00+05:30`).getTime() + 86400000;
  const all = withRunning(entries).filter((e) => !e.reversed);
  const before = all.filter((e) => new Date(e.at).getTime() < start);
  const brought = before.length ? before[before.length - 1].running : 0;
  const inRange = all.filter((e) => { const t = new Date(e.at).getTime(); return t >= start && t < end; });
  const closing = inRange.length ? inRange[inRange.length - 1].running : brought;
  return { brought, rows: inRange, closing };
}

export function printStatement(opts: {
  shop: string; party: string; phone?: string | null; from: string; to: string;
  entries: LedgerEntry[]; debitLabel: string; creditLabel: string; owedLabel: string;
}): boolean {
  const { brought, rows, closing } = statementRows(opts.entries, opts.from, opts.to);
  const d = (s: string) => new Date(s).toLocaleDateString("en-IN");
  const day = (s: string) => new Date(`${s}T12:00:00+05:30`).toLocaleDateString("en-IN");
  const body = rows.map((r) => `<tr><td>${d(r.at)}</td><td>${esc(r.label)}</td><td class="n">${r.debit ? rupees(r.debit) : ""}</td><td class="n">${r.credit ? rupees(r.credit) : ""}</td><td class="n">${rupees(r.running)}</td></tr>`).join("");
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Statement - ${esc(opts.party)}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; margin: 16px; color: #111; }
  h1 { font-size: 16px; margin: 0; } h2 { font-size: 13px; margin: 4px 0 12px; font-weight: normal; }
  table { width: 100%; border-collapse: collapse; } th, td { border-bottom: 1px solid #ccc; padding: 4px; text-align: left; }
  .n { text-align: right; white-space: nowrap; } tfoot td { font-weight: bold; border-top: 2px solid #111; }
</style></head><body>
<h1>${esc(opts.shop)}</h1>
<h2>Statement for <b>${esc(opts.party)}</b>${opts.phone ? ` (${esc(opts.phone)})` : ""} · ${day(opts.from)} to ${day(opts.to)}</h2>
<table><thead><tr><th>Date</th><th>Entry</th><th class="n">${opts.debitLabel}</th><th class="n">${opts.creditLabel}</th><th class="n">Balance</th></tr></thead>
<tbody><tr><td>${day(opts.from)}</td><td>Balance brought forward</td><td></td><td></td><td class="n">${rupees(brought)}</td></tr>${body}</tbody>
<tfoot><tr><td colspan="4">${closing >= 0 ? opts.owedLabel : "Advance"} on ${day(opts.to)}</td><td class="n">${rupees(Math.abs(closing))}</td></tr></tfoot></table>
<p style="margin-top:16px;color:#555">Printed ${new Date().toLocaleString("en-IN")} · DailyKart POS</p>
</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 300);
  return true;
}
