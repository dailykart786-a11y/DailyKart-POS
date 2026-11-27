import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/hooks/useStore";
import { Bell } from "lucide-react";

interface Alert { kind: string; severity: "danger" | "warning" | "info"; title: string; detail: string | null; item_count: number; link: string | null; }
const DOT: Record<string, string> = { danger: "bg-red-500", warning: "bg-amber-500", info: "bg-blue-500" };

/** Bell in the header: things that need attention. Hidden until the database update is run. */
export function AlertsBell() {
  const { filterStoreId } = useStore();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const { data, error } = await supabase.rpc("owner_alerts" as any, { p_location_id: filterStoreId } as any);
      if (!live) return;
      setAlerts(error || !Array.isArray(data) ? null : (data as any));
    };
    load();
    const t = window.setInterval(load, 120000);
    return () => { live = false; window.clearInterval(t); };
  }, [filterStoreId]);

  if (alerts === null) return null;
  const urgent = alerts.some((a) => a.severity === "danger");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="relative" aria-label={`Alerts: ${alerts.length}`}>
          <Bell className="h-4 w-4" />
          {alerts.length > 0 && (
            <span className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full px-1 text-[11px] leading-[18px] text-white ${urgent ? "bg-red-500" : "bg-amber-500"}`}>{alerts.length}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2 font-medium">Needs attention</div>
        {alerts.length === 0 ? <p className="px-3 py-4 text-sm text-muted-foreground">All clear</p> : (
          <ul className="max-h-96 overflow-y-auto">
            {alerts.map((a) => (
              <li key={a.kind} className="border-b last:border-0">
                <Link to={a.link || "/"} className="flex gap-2 px-3 py-2 hover:bg-muted">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[a.severity] || DOT.info}`} />
                  <span className="text-sm"><span className="font-medium">{a.title}</span>{a.detail && <span className="block text-muted-foreground">{a.detail}</span>}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
