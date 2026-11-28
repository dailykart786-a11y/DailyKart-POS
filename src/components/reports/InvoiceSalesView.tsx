// Invoice-wise sales: every bill in the dates, with customer, cashier, GST and payment.
// Read-only: queries the sales table directly, no database migration required.
import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/hooks/useStore";
import { toast } from "@/hooks/use-toast";
import { Download, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReportCtx, csvMeta, csvName, useReportData } from "./context";
import { Loaded, Section, inr, num } from "./shared";
import { downloadCsv } from "@/lib/gstReport";

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank: "Bank transfer",
  credit: "Udhaar (credit)",
  split: "Split",
};

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  created_at: string;
  total_amount: number;
  tax_amount: number;
  discount_amount: number;
  payment_method: string | null;
  credit_amount: number | null;
  status: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  cashier_name: string | null;
}

const isoDate = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Midnight IST at the start of `from`, and midnight IST just after `to` (matches report_period). */
function istBounds(from: string, to: string): { fromTs: string; toTs: string } {
  const fromTs = `${from}T00:00:00+05:30`;
  const next = new Date(Date.parse(`${to}T00:00:00+05:30`) + 86400000);
  const toTs = isoDate(next) + "T00:00:00+05:30";
  return { fromTs, toTs };
}

export function InvoiceSalesView({ ctx }: { ctx: ReportCtx }) {
  const { filterStoreId } = useStore();
  const [search, setSearch] = useState("");

  const state = useReportData(
    async (): Promise<{
      status: "ok";
      data: { rows: InvoiceRow[]; totals: { bills: number; total: number; gst: number } };
    }> | { status: "error"; error: unknown } => {
      const { fromTs, toTs } = istBounds(ctx.range.from, ctx.range.to);

      let q = supabase
        .from("sales")
        .select(
          "id, invoice_number, created_at, total_amount, tax_amount, discount_amount, payment_method, credit_amount, status, customer_id, cashier_id, location_id",
        )
        .neq("status", "cancelled")
        .gte("created_at", fromTs)
        .lt("created_at", toTs);

      if (filterStoreId) q = q.eq("location_id", filterStoreId);

      const { data: sales, error } = await q.order("created_at", { ascending: false }).limit(1000);
      if (error) return { status: "error", error };

      const rows = (sales || []) as any[];
      const customerIds = [...new Set(rows.map((s) => s.customer_id).filter(Boolean))];
      const cashierIds = [...new Set(rows.map((s) => s.cashier_id).filter(Boolean))];

      const [cRes, pRes] = await Promise.all([
        customerIds.length
          ? supabase.from("customers").select("id, name, phone").in("id", customerIds)
          : { data: [] },
        cashierIds.length
          ? supabase.from("profiles").select("user_id, full_name").in("user_id", cashierIds)
          : { data: [] },
      ]);

      const customers = new Map(
        ((cRes.data || []) as any[]).map((c) => [c.id, { name: c.name, phone: c.phone }]),
      );
      const cashiers = new Map(
        ((pRes.data || []) as any[]).map((p) => [p.user_id, p.full_name]),
      );

      const mapped: InvoiceRow[] = rows.map((s) => {
        const c = customers.get(s.customer_id);
        const cashier = cashiers.get(s.cashier_id);
        return {
          id: s.id,
          invoice_number: s.invoice_number,
          created_at: s.created_at,
          total_amount: Number(s.total_amount || 0),
          tax_amount: Number(s.tax_amount || 0),
          discount_amount: Number(s.discount_amount || 0),
          payment_method: s.payment_method,
          credit_amount: s.credit_amount == null ? null : Number(s.credit_amount),
          status: s.status,
          customer_name: c?.name || null,
          customer_phone: c?.phone || null,
          cashier_name: cashier || null,
        };
      });

      const totals = mapped.reduce(
        (a, r) => ({
          bills: a.bills + 1,
          total: a.total + r.total_amount,
          gst: a.gst + r.tax_amount,
        }),
        { bills: 0, total: 0, gst: 0 },
      );

      return { status: "ok", data: { rows: mapped, totals } };
    },
    [ctx.run, filterStoreId],
    ctx.onMissing,
  );

  const filtered = useMemo(
    () =>
      (state.status === "ok" ? state.data.rows : []).filter(
        (r) =>
          !search ||
          r.invoice_number.toLowerCase().includes(search) ||
          (r.customer_name || "").toLowerCase().includes(search) ||
          (r.cashier_name || "").toLowerCase().includes(search),
      ),
    [state.status === "ok" ? state.data.rows : [], search],
  );

  return (
    <Loaded state={state as any} kpis={3}>
      {({ rows, totals }) => {
        if (rows.length === 0) {
          return (
            <Section title="Invoice-wise sales" description="Every bill in the dates, with customer, cashier and payment.">
              <NoData title="No bills in these dates" description="Pick other dates, or check the store filter at the top." />
            </Section>
          );
        }
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground">Bills</div>
                <div className="text-base font-bold tabular-nums">{num(totals.bills)}</div>
              </div>
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground">Total billed</div>
                <div className="text-base font-bold tabular-nums">{inr(totals.total, 2)}</div>
              </div>
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground">GST collected</div>
                <div className="text-base font-bold tabular-nums">{inr(totals.gst, 2)}</div>
              </div>
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="Search invoice, customer or cashier"
                className="w-80"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <Section
              title="Invoices"
              description={`Every bill from ${new Date(ctx.range.from).toLocaleDateString("en-IN")} to ${new Date(
                ctx.range.to,
              ).toLocaleDateString("en-IN")}.`}
              csv={{
                filename: csvName(ctx, "invoice-wise-sales"),
                meta: csvMeta(ctx, "Invoice-wise sales", ["Amounts include GST"]),
                rows: filtered.map((r) => ({
                  "Invoice #": r.invoice_number,
                  Date: new Date(r.created_at).toLocaleDateString("en-IN"),
                  Customer: r.customer_name || "Walk-in",
                  Cashier: r.cashier_name || "—",
                  Phone: r.customer_phone || "—",
                  Method: METHOD_LABEL[r.payment_method || "cash"] || r.payment_method,
                  Status: r.status || "completed",
                  Total: r.total_amount,
                  GST: r.tax_amount,
                })),
              }}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Cashier</TableHead>
                    <TableHead className="text-right">Method</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">GST</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-sm">{r.invoice_number}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {new Date(r.created_at).toLocaleDateString("en-IN")}
                      </TableCell>
                      <TableCell>{r.customer_name || "Walk-in"}</TableCell>
                      <TableCell>{r.cashier_name || "—"}</TableCell>
                      <TableCell className="text-right text-sm">
                        {METHOD_LABEL[r.payment_method || "cash"] || r.payment_method}
                      </TableCell>
                      <TableCell className="text-right">{inr(r.total_amount, 2)}</TableCell>
                      <TableCell className="text-right">{inr(r.tax_amount, 2)}</TableCell>
                      <TableCell className="text-right text-sm">
                        {r.status === "cancelled" ? (
                          <span className="text-destructive">{r.status}</span>
                        ) : (
                          <span className="text-muted-foreground">{r.status || "completed"}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="font-semibold">
                    <TableCell colSpan={5}>Total</TableCell>
                    <TableCell className="text-right">{inr(totals.total, 2)}</TableCell>
                    <TableCell className="text-right">{inr(totals.gst, 2)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
              {filtered.length < rows.length && (
                <p className="text-xs text-muted-foreground mt-1">
                  Showing {filtered.length} of {rows.length} bills. Use search to narrow down.
                </p>
              )}
            </Section>
          </div>
        );
      }}
    </Loaded>
  );
}
