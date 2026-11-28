import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Clock } from "lucide-react";

interface Me { staff_id: string; name: string; shift_start: string | null; shift_end: string | null; check_in: string | null; check_out: string | null; status: string | null; late_minutes: number | null; }
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "");

/** Clock in / out for a signed-in user who is on the staff list. Shows nothing otherwise (or before the database update). */
export function ClockCard() {
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data, error } = await supabase.rpc("my_staff_today" as any);
    if (error || !data || !(data as any).staff_id) { setMe(null); return; }
    setMe(data as any);
  };
  useEffect(() => { load(); }, []);

  if (!me) return null;
  const act = async (fn: "clock_in" | "clock_out") => {
    setBusy(true);
    const { error } = await supabase.rpc(fn as any);
    setBusy(false);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    toast({ title: fn === "clock_in" ? "Clocked in" : "Clocked out" });
    load();
  };
  return (
    <Card className="mb-4">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-muted-foreground" />
          <div>
            <div className="font-medium">Hi {me.name}</div>
            <div className="text-sm text-muted-foreground">
              {me.shift_start ? `Shift ${me.shift_start.slice(0, 5)}–${(me.shift_end || "").slice(0, 5)} · ` : ""}
              {me.check_in ? `In at ${time(me.check_in)}${me.check_out ? `, out at ${time(me.check_out)}` : ""}` : "Not clocked in yet"}
              {me.late_minutes ? <Badge variant="destructive" className="ml-2">Late {me.late_minutes} min</Badge> : null}
            </div>
          </div>
        </div>
        {!me.check_in ? <Button onClick={() => act("clock_in")} disabled={busy}>Clock in</Button>
          : !me.check_out ? <Button variant="outline" onClick={() => act("clock_out")} disabled={busy}>Clock out</Button>
          : <Badge variant="secondary">Done for today</Badge>}
      </CardContent>
    </Card>
  );
}
