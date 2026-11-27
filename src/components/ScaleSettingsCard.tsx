import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/hooks/useStore";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "@/hooks/use-toast";
import { Scale } from "lucide-react";

/** Weighing-scale label format for this store (owner / manager). Hidden before the database update. */
export function ScaleSettingsCard() {
  const { workingStoreId } = useStore();
  const { role } = useUserRole();
  const [ready, setReady] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [value, setValue] = useState("weight");
  const [digits, setDigits] = useState("5");
  const [busy, setBusy] = useState(false);
  const canEdit = role === "admin" || role === "manager";

  useEffect(() => {
    setReady(false);
    if (!canEdit || !workingStoreId) return;
    let live = true;
    supabase.from("locations").select("scale_prefix, scale_value, scale_code_digits" as any).eq("id", workingStoreId).maybeSingle()
      .then(({ data, error }) => {
        if (!live || error || !data) return;
        const d = data as any;
        setPrefix(d.scale_prefix || ""); setValue(d.scale_value || "weight"); setDigits(String(d.scale_code_digits || 5));
        setReady(true);
      }, () => undefined);
    return () => { live = false; };
  }, [workingStoreId, canEdit]);

  if (!ready) return null;
  const valueDigits = 12 - prefix.length - (parseInt(digits) || 5);
  const save = async () => {
    if (prefix && !/^\d{1,3}$/.test(prefix)) { toast({ title: "The start digits are 1 to 3 numbers, like 21", variant: "destructive" }); return; }
    if (prefix && valueDigits < 3) { toast({ title: "That leaves too few digits for the weight", variant: "destructive" }); return; }
    setBusy(true);
    const { error } = await supabase.from("locations").update({ scale_prefix: prefix || null, scale_value: value, scale_code_digits: parseInt(digits) || 5 } as any).eq("id", workingStoreId!);
    setBusy(false);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    toast({ title: prefix ? "Scale labels turned on" : "Scale labels turned off" });
  };
  return (
    <Card className="mt-6">
      <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Scale className="h-5 w-5" /> Weighing scale labels</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">If your scale prints barcode stickers, match its settings here. Then scanning a sticker at billing adds the loose item with its weight. Give each loose product the same scale item code (PLU).</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1"><Label htmlFor="scale-prefix">Sticker starts with</Label><Input id="scale-prefix" inputMode="numeric" placeholder="e.g. 21 (empty = off)" value={prefix} onChange={(e) => setPrefix(e.target.value.replace(/\D/g, "").slice(0, 3))} /></div>
          <div className="space-y-1">
            <Label>Item code digits</Label>
            <Select value={digits} onValueChange={setDigits}>
              <SelectTrigger aria-label="Item code digits"><SelectValue /></SelectTrigger>
              <SelectContent>{["4", "5", "6"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Sticker holds</Label>
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger aria-label="Sticker holds"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="weight">Weight in grams</SelectItem><SelectItem value="price">Price in paise</SelectItem></SelectContent>
            </Select>
          </div>
        </div>
        {prefix && <p className="text-xs text-muted-foreground">Sticker layout: {prefix} + {digits}-digit item code + {valueDigits}-digit {value === "price" ? "price" : "weight"} + 1 check digit</p>}
        <Button onClick={save} disabled={busy}>Save scale settings</Button>
      </CardContent>
    </Card>
  );
}
