import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Area, Bar, BarChart, ComposedChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Download } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/feedback";
import { count, downloadCsv, groupDays, inr, inrShort, type DashboardData, type Grouping } from "@/lib/dashboard";

// Colours from the app theme so they follow light and dark mode
const C = {
  primary: "hsl(var(--primary))",
  green: "hsl(var(--success))",
  amber: "hsl(var(--warning))",
  red: "hsl(var(--destructive))",
  muted: "hsl(var(--muted-foreground))",
};
const PIE = ["hsl(217 91% 45%)", "hsl(142 70% 38%)", "hsl(43 96% 50%)", "hsl(280 60% 55%)", "hsl(0 75% 55%)", "hsl(190 80% 40%)", "hsl(25 90% 55%)", "hsl(215 16% 55%)"];

const axis = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const grid = <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />;
const tooltipStyle = {
  contentStyle: { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12, color: "hsl(var(--popover-foreground))" },
  labelStyle: { color: "hsl(var(--popover-foreground))", fontWeight: 600 },
};
const money = (v: unknown) => inr(Number(v));

interface Props {
  data: DashboardData;
  rangeLabel: string;
  storeLabel: string;
  hasPermission: (p: string) => boolean;
}

function ChartCard({ title, description, onExport, children }: { title: string; description?: string; onExport?: () => void; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 gap-2">
        <div className="min-w-0">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription className="text-xs">{description}</CardDescription>}
        </div>
        {onExport && (
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs shrink-0" onClick={onExport} aria-label={`Download ${title} as CSV`}>
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

const Empty = ({ text }: { text: string }) => <EmptyState title={text} description="Try a longer date range." className="py-10" />;

export function DashboardCharts({ data, rangeLabel, storeLabel, hasPermission }: Props) {
  const navigate = useNavigate();
  const [group, setGroup] = useState<Grouping>(data.days > 92 ? "month" : data.days > 31 ? "week" : "day");
  const canProfit = data.current.gross_profit !== undefined;
  const meta = [`DailyKart dashboard`, `Period: ${data.from} to ${data.to} (${rangeLabel})`, `Store: ${storeLabel}`, `Downloaded: ${new Date().toLocaleString("en-IN")}`];
  const file = (name: string) => `dailykart-${name}-${data.from}-to-${data.to}.csv`;

  const series = useMemo(() => groupDays(data.daily, group).map((r) => ({
    ...r,
    net: r.sales - r.returns,
    // Profit here is after GST-inclusive sales less cost; the period card shows the exact GST-excluded figure
    profit: r.cogs !== undefined ? r.sales - r.returns - r.cogs : undefined,
    margin: r.cogs !== undefined && r.sales - r.returns > 0 ? Math.round(((r.sales - r.returns - r.cogs) / (r.sales - r.returns)) * 1000) / 10 : undefined,
  })), [data.daily, group]);
  const anySales = data.daily.some((r) => r.sales > 0);
  const prevTotal = data.previous.gross_sales;

  const payments = [
    { name: "Cash", value: data.current.cash },
    { name: "UPI", value: data.current.upi },
    { name: "Card", value: data.current.card },
    { name: "Bank", value: data.current.bank },
    { name: "Credit (udhaar)", value: data.current.credit },
  ].filter((p) => p.value > 0);
  const paidVsCredit = [
    { name: "Paid now", value: Math.max(data.current.gross_sales - data.current.credit, 0) },
    { name: "On credit", value: data.current.credit },
  ].filter((p) => p.value > 0);

  const groupSelect = (
    <Select value={group} onValueChange={(v) => setGroup(v as Grouping)}>
      <SelectTrigger className="h-8 w-[130px]" aria-label="Group by"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="day">By day</SelectItem>
        <SelectItem value="week">By week</SelectItem>
        <SelectItem value="month">By month</SelectItem>
      </SelectContent>
    </Select>
  );

  return (
    <Tabs defaultValue="sales" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="sales">Sales</TabsTrigger>
          {canProfit && <TabsTrigger value="profit">Profit</TabsTrigger>}
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          {data.suppliers && <TabsTrigger value="purchases">Purchases</TabsTrigger>}
        </TabsList>
        {groupSelect}
      </div>

      {/* ---------------- Sales */}
      <TabsContent value="sales" className="grid gap-4 lg:grid-cols-3 mt-0">
        <div className="lg:col-span-2">
          <ChartCard title="Sales trend" description={`Gross sales and net sales after returns · previous period total ${inr(prevTotal)}`}
            onExport={() => downloadCsv(file("sales"), series.map((r) => ({ period: r.label, gross_sales: r.sales, returns: r.returns, net_sales: r.net, bills: r.bills })), meta)}>
            {!anySales ? <Empty text="No sales in this period" /> : (
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={series} margin={{ left: 0, right: 8, top: 8 }}>
                    <defs>
                      <linearGradient id="dkSales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.primary} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={C.primary} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    {grid}
                    <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={16} />
                    <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={inrShort} width={56} />
                    <Tooltip {...tooltipStyle} formatter={money} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="sales" name="Gross sales" stroke={C.primary} fill="url(#dkSales)" strokeWidth={2} />
                    <Line type="monotone" dataKey="net" name="Net sales" stroke={C.green} strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
        </div>
        <ChartCard title="Busy hours" description="Sales by hour of the day (India time)"
          onExport={() => downloadCsv(file("hours"), data.hourly.map((h) => ({ hour: `${h.hour}:00`, sales: h.sales, bills: h.bills })), meta)}>
          {!anySales ? <Empty text="No sales in this period" /> : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.hourly.filter((h) => h.hour >= 6 || h.sales > 0)} margin={{ left: 0, right: 4, top: 8 }}>
                  {grid}
                  <XAxis dataKey="hour" tick={axis} tickLine={false} axisLine={false} tickFormatter={(h) => `${h}`} />
                  <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={inrShort} width={48} />
                  <Tooltip {...tooltipStyle} labelFormatter={(h) => `${h}:00 – ${h}:59`} formatter={(v, n) => (n === "Bills" ? count(Number(v)) : money(v))} />
                  <Bar dataKey="sales" name="Sales" fill={C.primary} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
      </TabsContent>

      {/* ---------------- Profit */}
      {canProfit && (
        <TabsContent value="profit" className="grid gap-4 lg:grid-cols-3 mt-0">
          <div className="lg:col-span-2">
            <ChartCard title="Sales, costs and expenses" description="Net sales against cost of items sold and approved expenses"
              onExport={() => downloadCsv(file("profit"), series.map((r) => ({ period: r.label, net_sales: r.net, cost_of_goods: r.cogs ?? "", expenses: r.expenses ?? "", profit_before_expenses: r.profit ?? "" })), meta)}>
              {!anySales && !series.some((r) => (r.expenses || 0) > 0) ? <Empty text="No sales or expenses in this period" /> : (
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={series} margin={{ left: 0, right: 8, top: 8 }}>
                      {grid}
                      <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={16} />
                      <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={inrShort} width={56} />
                      <Tooltip {...tooltipStyle} formatter={money} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="net" name="Net sales" fill={C.primary} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="cogs" name="Cost of items" fill={C.muted} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="expenses" name="Expenses" fill={C.amber} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartCard>
          </div>
          <ChartCard title="Margin trend" description="Profit before expenses as a % of net sales (GST included)">
            {!anySales ? <Empty text="No sales in this period" /> : (
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ left: 0, right: 8, top: 8 }}>
                    {grid}
                    <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={16} />
                    <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} width={40} />
                    <Tooltip {...tooltipStyle} formatter={(v) => `${v}%`} />
                    <Line type="monotone" dataKey="margin" name="Margin" stroke={C.green} strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
        </TabsContent>
      )}

      {/* ---------------- Payments */}
      <TabsContent value="payments" className="grid gap-4 md:grid-cols-2 mt-0">
        <ChartCard title="How customers paid" description="Split payments are counted in each part"
          onExport={() => downloadCsv(file("payments"), payments.map((p) => ({ method: p.name, amount: p.value })), meta)}>
          {payments.length === 0 ? <Empty text="No payments in this period" /> : <Donut rows={payments} />}
        </ChartCard>
        <ChartCard title="Paid vs credit" description="How much of the sales was given on udhaar">
          {paidVsCredit.length === 0 ? <Empty text="No sales in this period" /> : <Donut rows={paidVsCredit} colors={[C.green, C.amber]} />}
        </ChartCard>
      </TabsContent>

      {/* ---------------- Products */}
      <TabsContent value="products" className="grid gap-4 lg:grid-cols-2 mt-0">
        <ChartCard title="Top 10 products" description="By sales value in the period"
          onExport={() => downloadCsv(file("top-products"), data.top_products.map((p) => ({ product: p.name, quantity: p.qty, sales: p.revenue })), meta)}>
          {data.top_products.length === 0 ? <Empty text="No products sold in this period" /> : (
            <div style={{ height: Math.max(200, data.top_products.length * 30) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.top_products} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <XAxis type="number" tick={axis} tickFormatter={inrShort} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={axis} width={110} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltipStyle} formatter={money} />
                  <Bar dataKey="revenue" name="Sales" fill={C.primary} radius={[0, 3, 3, 0]}
                    cursor={hasPermission("products") ? "pointer" : undefined}
                    onClick={() => hasPermission("products") && navigate("/products")} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
        <ChartCard title="Sales by category"
          onExport={() => downloadCsv(file("categories"), data.categories.map((c) => ({ category: c.category, quantity: c.qty, sales: c.revenue })), meta)}>
          {data.categories.length === 0 ? <Empty text="No products sold in this period" /> : <Donut rows={data.categories.map((c) => ({ name: c.category, value: c.revenue }))} />}
        </ChartCard>
        <div className="lg:col-span-2">
          <ChartCard title="Slow-moving stock" description="Items in stock that sold least in this period, biggest stock value first"
            onExport={() => downloadCsv(file("slow-products"), data.slow_products.map((p) => ({ product: p.name, sold: p.qty, in_stock: p.stock, stock_value: p.stock_value ?? "" })), meta)}>
            {data.slow_products.length === 0 ? <Empty text="No products in stock" /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-2 font-medium">Product</th>
                      <th className="py-2 font-medium text-right">Sold</th>
                      <th className="py-2 font-medium text-right">In stock</th>
                      {data.slow_products[0].stock_value !== undefined && <th className="py-2 font-medium text-right">Stock value</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.slow_products.map((p) => (
                      <tr key={p.product_id} className="border-b last:border-0">
                        <td className="py-2" data-no-translate>{p.name}</td>
                        <td className="py-2 text-right tabular-nums">{count(p.qty)}</td>
                        <td className="py-2 text-right tabular-nums">{count(p.stock)}</td>
                        {p.stock_value !== undefined && <td className="py-2 text-right tabular-nums">{inr(p.stock_value)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ChartCard>
        </div>
      </TabsContent>

      {/* ---------------- Customers */}
      <TabsContent value="customers" className="grid gap-4 md:grid-cols-2 mt-0">
        <ChartCard title="Who bought" description="Saved customers who bought in this period, and walk-in bills">
          {data.customers.buying === 0 && data.customers.walk_in_bills === 0 ? <Empty text="No sales in this period" /> : (
            <Donut
              rows={[
                { name: "Returning customers", value: data.customers.returning },
                { name: "First-time customers", value: Math.max(data.customers.buying - data.customers.returning, 0) },
                { name: "Walk-in bills", value: data.customers.walk_in_bills },
              ].filter((r) => r.value > 0)}
              format={count}
            />
          )}
        </ChartCard>
        <ChartCard title="Top customers" description="By spend in the period"
          onExport={() => downloadCsv(file("top-customers"), data.top_customers.map((c) => ({ customer: c.name, bills: c.bills, spent: c.spent })), meta)}>
          {data.top_customers.length === 0 ? <Empty text="No saved customers bought in this period" /> : (
            <ul className="divide-y">
              {data.top_customers.map((c, i) => (
                <li key={c.customer_id} className="flex items-center justify-between py-2 text-sm gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-5 text-muted-foreground tabular-nums">{i + 1}</span>
                    <span className="truncate" data-no-translate>{c.name}</span>
                  </span>
                  <span className="text-right tabular-nums shrink-0">
                    {inr(c.spent)} <span className="text-muted-foreground text-xs">· {c.bills} bill{c.bills === 1 ? "" : "s"}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
      </TabsContent>

      {/* ---------------- Purchases */}
      {data.suppliers && (
        <TabsContent value="purchases" className="mt-0">
          <ChartCard title="Purchases by supplier" description={`Supplier bills dated in the period · total ${inr(data.purchases_total)}`}
            onExport={() => downloadCsv(file("purchases"), (data.suppliers || []).map((s) => ({ supplier: s.name, bills: s.bills, total: s.total })), meta)}>
            {data.suppliers.length === 0 ? <Empty text="No purchases in this period" /> : (
              <div style={{ height: Math.max(200, data.suppliers.length * 34) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.suppliers} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <XAxis type="number" tick={axis} tickFormatter={inrShort} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={axis} width={120} axisLine={false} tickLine={false} />
                    <Tooltip {...tooltipStyle} formatter={money} />
                    <Bar dataKey="total" name="Purchases" fill={C.primary} radius={[0, 3, 3, 0]}
                      cursor={hasPermission("purchases") ? "pointer" : undefined}
                      onClick={() => hasPermission("purchases") && navigate("/purchases")} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
        </TabsContent>
      )}
    </Tabs>
  );
}

function Donut({ rows, colors = PIE, format = (n: number) => inr(n) }: { rows: { name: string; value: number }[]; colors?: string[]; format?: (n: number) => string }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <div className="h-[200px] w-[200px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={rows.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
              {rows.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
            </Pie>
            <Tooltip {...tooltipStyle} formatter={(v) => format(Number(v))} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full space-y-1.5 text-sm">
        {rows.map((r, i) => (
          <li key={r.name} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 min-w-0">
              <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: colors[i % colors.length] }} />
              <span className="truncate" data-no-translate>{r.name}</span>
            </span>
            <span className="tabular-nums shrink-0">
              {format(r.value)} <span className="text-muted-foreground text-xs">{total > 0 ? `${Math.round((r.value / total) * 100)}%` : ""}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
