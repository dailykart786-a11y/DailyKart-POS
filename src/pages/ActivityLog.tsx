import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useStore, inStore } from "@/hooks/useStore";
import { ScrollText } from "lucide-react";

interface Row {
  id: number; table_name: string; record_id: string | null; action: string;
  changes: Record<string, any> | null; changed_by: string | null; changed_at: string;
}

const TABLES: Record<string, string> = {
  sales: "Bill", sale_returns: "Return", customer_payments: "Khata payment", supplier_payments: "Supplier payment",
  purchases: "Purchase", stock_adjustments: "Stock adjustment", products: "Product", customers: "Customer",
  suppliers: "Supplier", expenses: "Expense", user_roles: "User role", user_location_assignments: "User store",
  locations: "Store settings", offers: "Offer", register_sessions: "Cash register", loyalty_redemptions: "Points used",
  product_batches: "Batch / expiry", payment_settings: "Payment settings",
};
const ACTION: Record<string, string> = { insert: "added", update: "changed", delete: "deleted" };
const HIDE = new Set(["id", "created_at", "updated_at", "location_id", "created_by", "cashier_id", "user_id"]);
const PAGE = 100;

const fmt = (v: any) => v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);

/** One line saying what happened, e.g. "Bill DK/26-27/0004 ₹105.00 (cash)". */
function summary(r: Row): string {
  const c = r.changes || {};
  if (r.action === "update") {
    return Object.entries(c).filter(([k]) => !HIDE.has(k)).slice(0, 4)
      .map(([k, v]: [string, any]) => `${k.replace(/_/g, " ")}: ${fmt(v?.old)} → ${fmt(v?.new)}`).join("; ");
  }
  switch (r.table_name) {
    case "sales": return `${c.invoice_number || ""} ₹${c.total_amount ?? ""} (${c.payment_method || ""})`;
    case "sale_returns": return `${c.return_number || ""} refund ₹${c.refund_amount ?? ""} by ${c.refund_method || ""}`;
    case "customer_payments": case "supplier_payments": return `₹${c.amount ?? ""} by ${c.method || ""}${c.note ? ` · ${c.note}` : ""}`;
    case "purchases": return `Bill ${c.bill_number || "—"} ₹${c.total_amount ?? ""}`;
    case "stock_adjustments": return `${c.quantity_change > 0 ? "+" : ""}${c.quantity_change} (${c.reason}) ${c.stock_before} → ${c.stock_after}`;
    case "expenses": return `₹${c.amount ?? ""} ${c.category || ""}${c.description ? ` · ${c.description}` : ""}`;
    case "user_roles": return `role ${c.role || ""}`;
    case "register_sessions": return c.closed_at ? `closed, counted ₹${c.counted_cash}` : `opened with ₹${c.opening_cash ?? 0}`;
    default: return c.name || c.batch_no || c.invoice_prefix || "";
  }
}

export default function ActivityLog() {
  const { filterStoreId } = useStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState(false);
  const [table, setTable] = useState("all");
  const [day, setDay] = useState("");
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const load = async (append = false) => {
    let q: any = inStore(supabase.from("audit_logs" as any).select("*"), filterStoreId)
      .order("changed_at", { ascending: false }).order("id", { ascending: false });
    if (table !== "all") q = q.eq("table_name", table);
    if (day) {
      const from = new Date(`${day}T00:00:00+05:30`);
      q = q.gte("changed_at", from.toISOString()).lt("changed_at", new Date(from.getTime() + 86400000).toISOString());
    }
    const start = append ? rows.length : 0;
    const { data, error } = await q.range(start, start + PAGE - 1);
    if (error) { setMissing(true); return; }
    setMissing(false);
    const list = (data || []) as Row[];
    setRows(append ? [...rows, ...list] : list);
    setMore(list.length === PAGE);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStoreId, table, day]);

  useEffect(() => {
    supabase.from("profiles").select("user_id, full_name").then(({ data }) =>
      setNames(Object.fromEntries(((data || []) as any[]).map((p) => [p.user_id, p.full_name || "Staff"]))));
  }, []);

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ScrollText className="h-6 w-6" /> Activity log</h1>
          <p className="text-muted-foreground">Who did what and when. Entries can't be edited or deleted.</p>
        </div>

        {missing ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">
            The activity log needs a database update. Ask your admin to run the latest dailykart-updates.sql in Supabase.
          </CardContent></Card>
        ) : (
          <Card>
            <CardContent className="p-4 space-y-3 overflow-x-auto">
              <div className="flex flex-wrap gap-2">
                <Select value={table} onValueChange={setTable}>
                  <SelectTrigger className="w-48" aria-label="What"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Everything</SelectItem>
                    {Object.entries(TABLES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="date" aria-label="Day" className="w-44" value={day} onChange={(e) => setDay(e.target.value)} />
                {day && <Button variant="ghost" onClick={() => setDay("")}>All days</Button>}
              </div>
              {rows.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center">Nothing recorded yet</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Who</TableHead>
                      <TableHead>What</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id} className="cursor-pointer align-top" onClick={() => setOpen(open === r.id ? null : r.id)}>
                        <TableCell className="text-sm whitespace-nowrap">{new Date(r.changed_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                        <TableCell className="text-sm">{r.changed_by ? names[r.changed_by] || "Staff" : "System"}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {TABLES[r.table_name] || r.table_name}{" "}
                          <Badge variant={r.action === "delete" ? "destructive" : r.action === "update" ? "outline" : "secondary"}>{ACTION[r.action] || r.action}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {summary(r)}
                          {open === r.id && (
                            <pre className="mt-2 whitespace-pre-wrap text-xs bg-muted p-2 rounded max-w-xl">{JSON.stringify(r.changes, null, 2)}</pre>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {more && <Button variant="outline" onClick={() => load(true)}>Show more</Button>}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
