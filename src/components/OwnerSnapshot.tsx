import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/hooks/useStore";
import { useUserRole } from "@/hooks/useUserRole";
import { rupees } from "@/lib/statement";
import { TrendingDown, TrendingUp } from "lucide-react";

interface Snap {
  today: number; today_bills: number; yesterday: number; last_week_same_day: number; month: number; last_month_same_period: number;
  gross_profit_today: number; udhaar_due: number; supplier_due: number; stock_value: number;
  stores: { location_id: string; name: string; today: number; month: number }[];
}

function Change({ now, before, label }: { now: number; before: number; label: string }) {
  if (!before) return <span className="text-xs text-muted-foreground">{label}: {rupees(before)}</span>;
  const pct = ((now - before) / before) * 100;
  const up = pct >= 0;
  return (
    <span className={`text-xs inline-flex items-center gap-1 ${up ? "text-green-700" : "text-red-600"}`}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{Math.abs(pct).toFixed(0)}% vs {label.toLowerCase()} ({rupees(before)})
    </span>
  );
}

/** Owner's one-glance numbers on the Dashboard (needs the Reports permission). */
export function OwnerSnapshot() {
  const { filterStoreId, isAdmin } = useStore();
  const { hasPermission } = useUserRole();
  const [snap, setSnap] = useState<Snap | null>(null);
  const allowed = hasPermission("reports");

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    (async () => {
      const { data, error } = await supabase.rpc("owner_snapshot" as any, { p_location_id: filterStoreId } as any);
      if (!live) return;
      if (error || !data || typeof data !== "object" || Array.isArray(data)) { setSnap(null); return; }
      const d: any = data;
      const n = (k: string) => Number(d[k]) || 0;
      setSnap({
        today: n("today"), today_bills: n("today_bills"), yesterday: n("yesterday"), last_week_same_day: n("last_week_same_day"),
        month: n("month"), last_month_same_period: n("last_month_same_period"), gross_profit_today: n("gross_profit_today"),
        udhaar_due: n("udhaar_due"), supplier_due: n("supplier_due"), stock_value: n("stock_value"),
        stores: Array.isArray(d.stores) ? d.stores.map((s: any) => ({ ...s, today: Number(s.today) || 0, month: Number(s.month) || 0 })) : [],
      });
    })();
    return () => { live = false; };
  }, [filterStoreId, allowed]);

  if (!allowed || !snap) return null;
  const tiles = [
    { label: "Sales today", value: rupees(snap.today), sub: <><span className="text-xs text-muted-foreground">{snap.today_bills} bills · </span><Change now={snap.today} before={snap.yesterday} label="Yesterday" /></> },
    { label: "Same day last week", value: rupees(snap.last_week_same_day), sub: <Change now={snap.today} before={snap.last_week_same_day} label="Last week" /> },
    { label: "This month", value: rupees(snap.month), sub: <Change now={snap.month} before={snap.last_month_same_period} label="Last month" /> },
    { label: "Gross profit today", value: rupees(snap.gross_profit_today), sub: <span className="text-xs text-muted-foreground">Sales before GST less cost price</span> },
    { label: "Udhaar to collect", value: rupees(snap.udhaar_due), sub: null },
    { label: "Owed to suppliers", value: rupees(snap.supplier_due), sub: null },
    { label: "Stock value (cost)", value: rupees(snap.stock_value), sub: null },
  ];
  return (
    <Card className="mb-4">
      <CardHeader className="pb-2"><CardTitle className="text-lg">Owner view</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{t.label}</div>
              <div className="text-lg font-semibold">{t.value}</div>
              {t.sub && <div className="flex flex-wrap gap-1">{t.sub}</div>}
            </div>
          ))}
        </div>
        {isAdmin && !filterStoreId && snap.stores.length > 1 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1">Store</th><th className="text-right">Today</th><th className="text-right">This month</th></tr></thead>
              <tbody>{snap.stores.map((s) => <tr key={s.location_id} className="border-t"><td className="py-1">{s.name}</td><td className="text-right">{rupees(s.today)}</td><td className="text-right">{rupees(s.month)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
