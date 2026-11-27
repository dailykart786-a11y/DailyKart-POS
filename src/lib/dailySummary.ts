// End-of-day summary: the day's numbers as a short WhatsApp message.
import { supabase } from "@/integrations/supabase/client";
import { inStore } from "@/hooks/useStore";

export interface DailySummary {
  date: string; // YYYY-MM-DD (India time)
  bills: number;
  sales: number;
  gst: number;
  byMethod: Record<string, number>;
  udhaarGiven: number;
  khataReceived: number;
  returns: number;
  expenses: number;
  topItems: { name: string; qty: number; amount: number }[];
  lowStock: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Start and end of a day in India time, as ISO strings. */
export const istDayRange = (date: string) => {
  const start = new Date(`${date}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 86400000);
  return { from: start.toISOString(), to: end.toISOString() };
};

export const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

async function pages<T>(make: (from: number, to: number) => PromiseLike<{ data: any; error: any }>): Promise<{ rows: T[]; error: any }> {
  const rows: T[] = [];
  for (let i = 0; i < 20; i++) {
    const { data, error } = await make(i * 1000, i * 1000 + 999);
    if (error) return { rows, error };
    rows.push(...((data || []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return { rows, error: null };
}

export async function fetchDailySummary(date: string, storeId: string | null): Promise<DailySummary> {
  const { from, to } = istDayRange(date);

  // Bills (newer columns first, older database as fallback)
  let sales = await pages<any>((a, b) => inStore(
    supabase.from("sales").select("total_amount, tax_amount, payment_method, payment_split, credit_amount" as any), storeId,
  ).gte("created_at", from).lt("created_at", to).range(a, b));
  if (sales.error) {
    sales = await pages<any>((a, b) => inStore(
      supabase.from("sales").select("total_amount, tax_amount, payment_method"), storeId,
    ).gte("created_at", from).lt("created_at", to).range(a, b));
  }
  if (sales.error) throw sales.error;

  const byMethod: Record<string, number> = {};
  let total = 0, gst = 0, udhaar = 0;
  for (const s of sales.rows) {
    const amt = Number(s.total_amount || 0);
    total += amt;
    gst += Number(s.tax_amount || 0);
    if (s.payment_split && typeof s.payment_split === "object") {
      for (const [k, v] of Object.entries(s.payment_split as Record<string, number>)) byMethod[k] = (byMethod[k] || 0) + Number(v || 0);
    } else {
      const m = s.payment_method || "cash";
      byMethod[m] = (byMethod[m] || 0) + amt;
    }
    udhaar += s.credit_amount != null ? Number(s.credit_amount || 0) : s.payment_method === "credit" ? amt : 0;
  }

  const [items, returns, expenses, khata, products] = await Promise.all([
    pages<any>((a, b) => {
      let q: any = supabase.from("sale_items").select("quantity, total_price, products(name), sales!inner(created_at, location_id)")
        .gte("sales.created_at", from).lt("sales.created_at", to);
      if (storeId) q = q.eq("sales.location_id", storeId);
      return q.range(a, b);
    }),
    pages<any>((a, b) => inStore(supabase.from("sale_returns" as any).select("refund_amount"), storeId).gte("created_at", from).lt("created_at", to).range(a, b)),
    pages<any>((a, b) => inStore(supabase.from("expenses").select("amount"), storeId).eq("date", date).range(a, b)),
    pages<any>((a, b) => inStore(supabase.from("customer_payments" as any).select("amount"), storeId).gte("created_at", from).lt("created_at", to).range(a, b)),
    pages<any>((a, b) => inStore(supabase.from("products").select("stock_quantity, min_stock_level").eq("is_active", true), storeId).range(a, b)),
  ]);

  const top: Record<string, { name: string; qty: number; amount: number }> = {};
  for (const it of items.rows) {
    const name = it.products?.name || "Item";
    const t = (top[name] ||= { name, qty: 0, amount: 0 });
    t.qty += Number(it.quantity || 0);
    t.amount += Number(it.total_price || 0);
  }

  return {
    date,
    bills: sales.rows.length,
    sales: r2(total),
    gst: r2(gst),
    byMethod: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, r2(v)])),
    udhaarGiven: r2(udhaar),
    khataReceived: r2(khata.rows.reduce((s, x) => s + Number(x.amount || 0), 0)),
    returns: r2(returns.rows.reduce((s, x) => s + Number(x.refund_amount || 0), 0)),
    expenses: r2(expenses.rows.reduce((s, x) => s + Number(x.amount || 0), 0)),
    topItems: Object.values(top).sort((a, b) => b.amount - a.amount).slice(0, 5).map((t) => ({ ...t, amount: r2(t.amount) })),
    lowStock: products.rows.filter((p) => Number(p.stock_quantity || 0) <= Number(p.min_stock_level || 0)).length,
  };
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const METHOD: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", credit: "Udhaar", bank: "Bank transfer" };

export function summaryText(s: DailySummary, storeName: string): string {
  const day = new Date(`${s.date}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const lines = [
    `*${storeName} · ${day}*`,
    "",
    `🧾 Bills: ${s.bills}`,
    `💰 Sales: *${inr(s.sales)}* (GST ${inr(s.gst)})`,
  ];
  const methods = Object.entries(s.byMethod).filter(([, v]) => v > 0);
  if (methods.length) lines.push(...methods.map(([k, v]) => `   • ${METHOD[k] || k}: ${inr(v)}`));
  if (s.returns) lines.push(`↩️ Returns: ${inr(s.returns)}`);
  if (s.udhaarGiven) lines.push(`📒 Udhaar given: ${inr(s.udhaarGiven)}`);
  if (s.khataReceived) lines.push(`📒 Udhaar received: ${inr(s.khataReceived)}`);
  if (s.expenses) lines.push(`💸 Expenses: ${inr(s.expenses)}`);
  lines.push(`📈 Net (sales − returns − expenses): *${inr(r2(s.sales - s.returns - s.expenses))}*`);
  if (s.topItems.length) {
    lines.push("", "*Top items*");
    s.topItems.forEach((t, i) => lines.push(`${i + 1}. ${t.name} × ${t.qty} = ${inr(t.amount)}`));
  }
  if (s.lowStock) lines.push("", `⚠️ ${s.lowStock} item${s.lowStock === 1 ? "" : "s"} low on stock`);
  lines.push("", "_Sent from DailyKart POS_");
  return lines.join("\n");
}

/** wa.me link; with no number WhatsApp asks who to send it to. */
export function whatsappLink(text: string, phone?: string | null): string {
  let digits = (phone || "").replace(/\D/g, "");
  if (digits.length === 10) digits = "91" + digits;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
