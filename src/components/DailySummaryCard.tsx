import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/hooks/useStore";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "@/hooks/use-toast";
import { fetchDailySummary, istToday, summaryText, whatsappLink } from "@/lib/dailySummary";
import { MessageCircle, Copy, RefreshCw } from "lucide-react";

/** The day's numbers as a WhatsApp message for the owner. */
export function DailySummaryCard() {
  const { filterStoreId, workingStoreId, stores, isAdmin } = useStore();
  const { role } = useUserRole();
  const [date, setDate] = useState(istToday());
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [phone, setPhone] = useState("");
  const [savedPhone, setSavedPhone] = useState("");
  const [phoneColumn, setPhoneColumn] = useState(true);

  const storeName = filterStoreId
    ? stores.find((s) => s.id === filterStoreId)?.name || "DailyKart"
    : isAdmin && stores.length > 1 ? "All stores" : stores.find((s) => s.id === workingStoreId)?.name || "DailyKart";

  const build = async () => {
    setLoading(true);
    try {
      const s = await fetchDailySummary(date, filterStoreId);
      setText(summaryText(s, storeName));
    } catch (e: any) {
      toast({ title: "Could not make the summary", description: e?.message || "Check your internet", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    build();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, filterStoreId, storeName]);

  useEffect(() => {
    if (!workingStoreId) return;
    supabase.from("locations").select("summary_whatsapp" as any).eq("id", workingStoreId).maybeSingle()
      .then(({ data, error }: any) => {
        if (error) { setPhoneColumn(false); return; }
        setPhone(data?.summary_whatsapp || "");
        setSavedPhone(data?.summary_whatsapp || "");
      }, () => undefined);
  }, [workingStoreId]);

  const savePhone = async () => {
    if (!workingStoreId) return;
    const clean = phone.trim();
    if (clean && clean.replace(/\D/g, "").length < 10) { toast({ title: "Enter a 10 digit mobile number", variant: "destructive" }); return; }
    const { error } = await supabase.from("locations").update({ summary_whatsapp: clean || null } as any).eq("id", workingStoreId);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    setSavedPhone(clean);
    toast({ title: "Number saved", description: "Summaries will open a chat with this number" });
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast({ title: "Copied" }); }
    catch { toast({ title: "Could not copy", description: "Select the text and copy it", variant: "destructive" }); }
  };

  const canEditPhone = (role === "manager" || role === "admin") && phoneColumn;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-lg flex items-center gap-2"><MessageCircle className="h-5 w-5" /> Daily summary for WhatsApp</CardTitle>
        <div className="flex items-center gap-2">
          <Input type="date" aria-label="Summary date" className="h-9 w-40" value={date} max={istToday()} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <Button size="icon" variant="outline" className="h-9 w-9" aria-label="Refresh summary" disabled={loading} onClick={build}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm font-sans min-h-[6rem]">{loading && !text ? "Working it out..." : text}</pre>
        {canEditPhone && (
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="space-y-2 flex-1">
              <Label htmlFor="sum-phone">Owner's WhatsApp number</Label>
              <Input id="sum-phone" inputMode="tel" placeholder="e.g. 98xxxxxx10" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            {phone.trim() !== savedPhone && <Button variant="outline" onClick={savePhone}>Save number</Button>}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button className="gap-2" disabled={!text} onClick={() => window.open(whatsappLink(text, savedPhone || phone), "_blank")}>
            <MessageCircle className="h-4 w-4" /> Send on WhatsApp
          </Button>
          <Button variant="outline" className="gap-2" disabled={!text} onClick={copy}><Copy className="h-4 w-4" /> Copy</Button>
        </div>
        <p className="text-xs text-muted-foreground">WhatsApp opens with the message ready; press send. Sending by itself every night would need a paid WhatsApp Business API account.</p>
      </CardContent>
    </Card>
  );
}
