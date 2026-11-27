// Product and customer reports: one page of rows at a time from the database,
// with search, sort and (products) a category filter applied on the server.
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { inrShort } from "@/lib/dashboard";
import { reportBreakdown, reportCustomers, reportProducts } from "@/lib/reports/api";
import { ReportCtx, csvMeta, csvName, useReportData } from "./context";
import { Kpi, Loaded, NoData, Section, inr, num, pct } from "./shared";
import { Pager, useDebounced } from "./paging";

const R = "text-right";
// ---------------------------------------------------------------- products
const PRODUCT_SORTS = [
  { key: "revenue", label: "Net sales" }, { key: "units", label: "Units sold" }, { key: "profit", label: "Gross profit" },
  { key: "margin", label: "Margin" }, { key: "returns", label: "Returns" }, { key: "name", label: "Name" },
];

export function ProductPerformance({ ctx, defaultSort = "revenue" }: { ctx: ReportCtx; defaultSort?: string }) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [category, setCategory] = useState<string>("all");
  const [sort, setSort] = useState(defaultSort);
  const [dir, setDir] = useState<"asc" | "desc">(defaultSort === "name" ? "asc" : "desc");
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  useEffect(() => { setPage(0); }, [q, category, sort, dir, ctx.run, ctx.storeId]);

  const cats = useReportData(() => reportBreakdown(ctx.range.from, ctx.range.to, ctx.storeId, "category"), [ctx.run, ctx.storeId], ctx.onMissing);
  const state = useReportData(
    () => reportProducts(ctx.range.from, ctx.range.to, ctx.storeId, { search: q || null, category: category === "all" ? null : category, sort, dir, limit: size, offset: page * size }),
    [ctx.run, ctx.storeId, q, category, sort, dir, page, size], ctx.onMissing,
  );
  const catList = cats.status === "ok" ? cats.data.map((c) => c.key) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input className="w-full sm:w-64" placeholder="Search name, SKU or barcode" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Category"><SelectValue placeholder="All categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {catList.filter((c) => c !== "Uncategorised").map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => { setSort(v); setDir(v === "name" ? "asc" : "desc"); }}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Sort by"><SelectValue /></SelectTrigger>
          <SelectContent>{PRODUCT_SORTS.map((s) => <SelectItem key={s.key} value={s.key}>Sort: {s.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" onClick={() => setDir(dir === "desc" ? "asc" : "desc")} aria-label="Reverse order">
          {dir === "desc" ? "Highest first" : "Lowest first"}
        </Button>
      </div>
      <Loaded state={state} kpis={4}>
        {(pr) => {
          if (pr.total === 0) return <NoData title={q || category !== "all" ? "No products match" : "No products sold in these dates"} />;
          const top = page === 0 && sort !== "name" ? pr.rows.slice(0, 10).map((r) => ({ name: r.name.length > 18 ? r.name.slice(0, 17) + "…" : r.name, net: r.net_revenue, profit: r.profit ?? 0 })) : [];
          return (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi label="Products sold" value={num(pr.total)} hint={q || category !== "all" ? "matching the filter" : undefined} />
                <Kpi label="Units sold" value={num(pr.totals.units)} />
                <Kpi k="net_sales" value={inr(pr.totals.net_revenue)} />
                <Kpi k="gross_profit" value={inr(pr.totals.profit)} hint={pr.totals.cost_missing_value ? `${inr(pr.totals.cost_missing_value)} sales without saved cost left out` : undefined} />
              </div>
              {top.length > 0 && (
                <Section title={`Top ${top.length} by ${PRODUCT_SORTS.find((s) => s.key === sort)?.label.toLowerCase()}`} description="Without GST, after returns.">
                  <ResponsiveContainer width="100%" height={Math.max(220, top.length * 32)}>
                    <BarChart data={top} layout="vertical" margin={{ left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={(v) => inrShort(Number(v))} />
                      <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v, name) => [inr(Number(v)), name]} /><Legend />
                      <Bar dataKey="net" name="Net sales" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} />
                      <Bar dataKey="profit" name="Gross profit" fill="hsl(var(--success))" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Section>
              )}
              <Section title="Products" description="Amounts without GST. Cost is what each unit cost when it was sold."
                csv={{ filename: csvName(ctx, "products"), meta: csvMeta(ctx, "Product performance", ["Without GST", `Rows ${page * size + 1} to ${page * size + pr.rows.length} of ${pr.total}`, ...(q ? [`Search: ${q}`] : []), ...(category !== "all" ? [`Category: ${category}`] : [])]),
                  rows: pr.rows.map((r) => ({ product: r.name, sku: r.sku, barcode: r.barcode, category: r.category, units_sold: r.units, sales: r.revenue, discount: r.discount,
                    returned_qty: r.returned_qty, returns: r.returned_value, net_sales: r.net_revenue, cost: r.cogs ?? "", gross_profit: r.profit ?? "", margin_pct: r.margin ?? "",
                    stock_now: r.stock_quantity, cost_price_now: r.cost_price, selling_price: r.price, mrp: r.mrp })) }}>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Product</TableHead><TableHead>Category</TableHead><TableHead className={R}>Units</TableHead>
                    <TableHead className={R}>Returned</TableHead><TableHead className={R}>Net sales</TableHead><TableHead className={R}>Cost</TableHead>
                    <TableHead className={R}>Profit</TableHead><TableHead className={R}>Margin</TableHead><TableHead className={R}>Stock now</TableHead>
                    <TableHead className={R}>Price / MRP</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {pr.rows.map((r) => (
                      <TableRow key={r.product_id}>
                        <TableCell><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{[r.sku, r.barcode].filter(Boolean).join(" · ")}</div></TableCell>
                        <TableCell>{r.category || "—"}</TableCell>
                        <TableCell className={R}>{num(r.units)}</TableCell>
                        <TableCell className={R}>{r.returned_qty ? num(r.returned_qty) : "—"}</TableCell>
                        <TableCell className={R}>{inr(r.net_revenue, 2)}</TableCell>
                        <TableCell className={R}>{r.cogs === null ? "not saved" : inr(r.cogs, 2)}</TableCell>
                        <TableCell className={`${R} ${(r.profit ?? 0) < 0 ? "text-destructive" : ""}`}>{inr(r.profit, 2)}</TableCell>
                        <TableCell className={R}>{pct(r.margin)}</TableCell>
                        <TableCell className={R}>{num(r.stock_quantity)}</TableCell>
                        <TableCell className={`${R} text-xs`}>{inr(r.price, 2)}{r.mrp ? ` / ${inr(r.mrp, 2)}` : ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Pager page={page} size={size} total={pr.total} setPage={setPage} setSize={setSize} />
              </Section>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

// ---------------------------------------------------------------- customers
const CUSTOMER_SORTS = [{ key: "spend", label: "Spend" }, { key: "bills", label: "Number of bills" }, { key: "due", label: "Owes now" }, { key: "last", label: "Last bill" }];

export function CustomerAnalysis({ ctx }: { ctx: ReportCtx }) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [sort, setSort] = useState("spend");
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  useEffect(() => { setPage(0); }, [q, sort, ctx.run, ctx.storeId]);
  const state = useReportData(
    () => reportCustomers(ctx.range.from, ctx.range.to, ctx.storeId, { search: q || null, sort, dir: "desc", limit: size, offset: page * size }),
    [ctx.run, ctx.storeId, q, sort, page, size], ctx.onMissing,
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input className="w-full sm:w-64" placeholder="Search name or phone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customers" />
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Sort by"><SelectValue /></SelectTrigger>
          <SelectContent>{CUSTOMER_SORTS.map((s) => <SelectItem key={s.key} value={s.key}>Sort: {s.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Loaded state={state} kpis={4}>
        {(c) => {
          const repeatRate = c.total > 0 ? (c.repeat_customers * 100) / c.total : null;
          return (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi label="Customers who bought" value={num(c.total)} hint={q ? "matching the search" : undefined} />
                <Kpi label="New customers" value={num(c.new_customers)} hint="first ever bill in these dates" />
                <Kpi label="Bought more than once" value={num(c.repeat_customers)} hint={repeatRate !== null ? `${repeatRate.toFixed(0)}% repeat rate` : undefined} />
                <Kpi label="Walk-in bills" value={num(c.walk_in_bills)} hint="bills without a customer" />
              </div>
              {c.total === 0 ? <NoData title={q ? "No customers match" : "No named customers bought in these dates"} description="Bills without a customer are counted as walk-in." /> : (
                <Section title="Customers" description='Spend includes GST, after refunds. "New" means their first ever bill falls in these dates.'
                  csv={{ filename: csvName(ctx, "customers"), meta: csvMeta(ctx, "Customer analysis", ["Spend includes GST", `Rows ${page * size + 1} to ${page * size + c.rows.length} of ${c.total}`]),
                    rows: c.rows.map((r) => ({ customer: r.name, phone: r.phone, bills: r.bills, spent: r.spend, refunds: r.refunds, net_spent: r.net_spend, avg_bill: r.avg_bill ?? "", new_in_period: r.is_new ? "yes" : "no", owes_now: r.due, loyalty_points: r.loyalty_points ?? "" })) }}>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Customer</TableHead><TableHead className={R}>Bills</TableHead><TableHead className={R}>Spent</TableHead>
                      <TableHead className={R}>Refunds</TableHead><TableHead className={R}>Avg bill</TableHead><TableHead className={R}>Owes now</TableHead><TableHead>Last bill</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {c.rows.map((r) => (
                        <TableRow key={r.customer_id}>
                          <TableCell><div className="font-medium">{r.name}{r.is_new && <span className="ml-2 text-xs rounded bg-primary/10 text-primary px-1.5 py-0.5">New</span>}</div><div className="text-xs text-muted-foreground">{r.phone}</div></TableCell>
                          <TableCell className={R}>{r.bills}</TableCell><TableCell className={R}>{inr(r.net_spend, 2)}</TableCell>
                          <TableCell className={R}>{r.refunds ? inr(r.refunds, 2) : "—"}</TableCell><TableCell className={R}>{inr(r.avg_bill, 2)}</TableCell>
                          <TableCell className={`${R} ${r.due > 0 ? "text-destructive" : ""}`}>{r.due ? inr(r.due, 2) : "—"}</TableCell>
                          <TableCell>{r.last_at ? new Date(r.last_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Pager page={page} size={size} total={c.total} setPage={setPage} setSize={setSize} />
                </Section>
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
