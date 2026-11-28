import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "@/hooks/use-toast";
import { todayIso } from "@/lib/batches";
import { KeyRound, Save, Ticket, Trash2 } from "lucide-react";

const NEEDS_UPDATE = "Ask your admin to run the latest dailykart-updates.sql in Supabase first.";

/** Most a cashier may discount, and the manager's approval PIN. */
export function DiscountRulesCard({ storeId }: { storeId: string }) {
  const { role } = useUserRole();
  const [available, setAvailable] = useState(true);
  const [maxPct, setMaxPct] = useState("");
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const canPin = role === "admin" || role === "manager";

  useEffect(() => {
    supabase.from("locations").select("max_discount_pct" as any).eq("id", storeId).maybeSingle().then(({ data, error }: any) => {
      if (error) { setAvailable(false); return; }
      setAvailable(true);
      setMaxPct(data?.max_discount_pct == null ? "" : String(Number(data.max_discount_pct)));
    }, () => setAvailable(false));
    supabase.rpc("has_my_pin" as any).then(({ data, error }: any) => setHasPin(error ? null : !!data), () => setHasPin(null));
  }, [storeId]);

  if (!available) return null;

  const saveMax = async () => {
    const v = maxPct.trim() === "" ? null : Number(maxPct);
    if (v != null && !(v >= 0 && v <= 100)) { toast({ title: "Enter 0 to 100, or leave it empty for no limit", variant: "destructive" }); return; }
    setBusy(true);
    const { error } = await supabase.from("locations").update({ max_discount_pct: v } as any).eq("id", storeId);
    setBusy(false);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Saved", description: v == null ? "Cashiers can give any discount" : `Cashiers can give up to ${v}% without a manager` });
  };

  const savePin = async () => {
    if (!/^[0-9]{4,6}$/.test(pin)) { toast({ title: "PIN must be 4 to 6 digits", variant: "destructive" }); return; }
    if (pin !== pin2) { toast({ title: "The two PINs don't match", variant: "destructive" }); return; }
    setBusy(true);
    const { error } = await supabase.rpc("set_my_pin" as any, { p_pin: pin } as any);
    setBusy(false);
    if (error) { toast({ title: "PIN not saved", description: error.code === "PGRST202" ? NEEDS_UPDATE : error.message, variant: "destructive" }); return; }
    setPin(""); setPin2(""); setHasPin(true);
    toast({ title: "Approval PIN saved", description: "Type it on the till to allow a bigger discount" });
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg flex items-center gap-2"><KeyRound className="h-5 w-5" /> Discount limit and approval</CardTitle></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="max-disc">Most a cashier can give without a manager (%)</Label>
          <div className="flex gap-2">
            <Input id="max-disc" inputMode="decimal" placeholder="No limit" value={maxPct} onChange={(e) => setMaxPct(e.target.value)} />
            <Button variant="outline" disabled={busy} onClick={saveMax} className="gap-1"><Save className="h-4 w-4" /> Save</Button>
          </div>
          <p className="text-xs text-muted-foreground">Counts discounts typed on a line or on the whole bill. Offers, coupons and points don't count.</p>
        </div>
        {canPin && (
          <div className="space-y-2">
            <Label>My approval PIN {hasPin ? <Badge variant="secondary" className="ml-1">set</Badge> : hasPin === false ? <Badge variant="outline" className="ml-1">not set</Badge> : null}</Label>
            <div className="flex gap-2">
              <Input type="password" inputMode="numeric" autoComplete="new-password" aria-label="New PIN" placeholder="4-6 digits" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
              <Input type="password" inputMode="numeric" autoComplete="new-password" aria-label="PIN again" placeholder="Again" maxLength={6} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} />
              <Button variant="outline" disabled={busy || pin.length < 4} onClick={savePin}>{hasPin ? "Change" : "Set"}</Button>
            </div>
            <p className="text-xs text-muted-foreground">Each manager has their own PIN. Every approval is kept with who approved it.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface Coupon {
  id: string; code: string; kind: "percent" | "flat"; value: number; min_bill: number | null;
  max_uses: number | null; starts_on: string | null; ends_on: string | null; is_active: boolean;
}

/** Coupon codes the cashier types at billing. */
export function CouponsCard({ storeId }: { storeId: string }) {
  const [available, setAvailable] = useState(true);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [uses, setUses] = useState<Record<string, number>>({});
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percent" | "flat">("percent");
  const [value, setValue] = useState("");
  const [minBill, setMinBill] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [ends, setEnds] = useState("");
  const [busy, setBusy] = useState(false);
  const today = todayIso();

  const load = async () => {
    const { data, error } = await supabase.from("coupons" as any).select("*").eq("location_id", storeId).order("created_at", { ascending: false });
    if (error) { setAvailable(false); return; }
    setAvailable(true);
    setCoupons(((data || []) as any[]).map((c) => ({ ...c, value: Number(c.value), min_bill: c.min_bill == null ? null : Number(c.min_bill) })));
    const r = await supabase.from("coupon_redemptions" as any).select("coupon_id").eq("location_id", storeId).limit(5000);
    const count: Record<string, number> = {};
    for (const x of (r.data || []) as any[]) count[x.coupon_id] = (count[x.coupon_id] || 0) + 1;
    setUses(count);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  if (!available) return null;

  const add = async () => {
    const c = code.trim().toUpperCase();
    const v = parseFloat(value);
    if (!/^[A-Z0-9-]{3,20}$/.test(c)) { toast({ title: "Code: 3 to 20 letters or numbers", variant: "destructive" }); return; }
    if (!(v > 0) || (kind === "percent" && v > 90)) { toast({ title: kind === "percent" ? "Enter 1% to 90%" : "Enter the rupees off", variant: "destructive" }); return; }
    setBusy(true);
    const { error } = await supabase.from("coupons" as any).insert({
      location_id: storeId, code: c, kind, value: v,
      min_bill: minBill.trim() ? parseFloat(minBill) : null,
      max_uses: maxUses.trim() ? parseInt(maxUses, 10) : null,
      starts_on: today, ends_on: ends || null,
    } as any);
    setBusy(false);
    if (error) {
      toast({ title: "Not saved", description: error.code === "23505" ? "This code already exists" : error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Coupon added", description: c });
    setCode(""); setValue(""); setMinBill(""); setMaxUses(""); setEnds("");
    load();
  };

  const toggle = async (c: Coupon) => {
    const { error } = await supabase.from("coupons" as any).update({ is_active: !c.is_active } as any).eq("id", c.id);
    if (error) toast({ title: "Not saved", description: error.message, variant: "destructive" });
    load();
  };
  const remove = async (c: Coupon) => {
    const { error } = await supabase.from("coupons" as any).delete().eq("id", c.id);
    if (error) toast({ title: "Can't delete a used coupon", description: "Pause it instead", variant: "destructive" });
    load();
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Ticket className="h-5 w-5" /> Coupons</CardTitle></CardHeader>
      <CardContent className="space-y-4 overflow-x-auto">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7 items-end">
          <div className="space-y-1 lg:col-span-2">
            <Label htmlFor="cp-code">Code</Label>
            <Input id="cp-code" placeholder="e.g. DIWALI50" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </div>
          <div className="space-y-1">
            <Label>Off</Label>
            <div className="flex gap-1">
              <Input aria-label="Coupon value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
              <Select value={kind} onValueChange={(v) => setKind(v as "percent" | "flat")}>
                <SelectTrigger className="w-16" aria-label="Coupon type"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="percent">%</SelectItem><SelectItem value="flat">₹</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cp-min">Min bill ₹</Label>
            <Input id="cp-min" inputMode="decimal" placeholder="Any" value={minBill} onChange={(e) => setMinBill(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cp-uses">Times it can be used</Label>
            <Input id="cp-uses" inputMode="numeric" placeholder="No limit" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cp-end">Until</Label>
            <Input id="cp-end" type="date" value={ends} min={today} onChange={(e) => setEnds(e.target.value)} />
          </div>
          <Button onClick={add} disabled={busy}>Add coupon</Button>
        </div>
        {coupons.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Off</TableHead>
                <TableHead>Used</TableHead>
                <TableHead>Until</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {coupons.map((c) => {
                const used = uses[c.id] || 0;
                const live = c.is_active && (!c.ends_on || c.ends_on >= today) && (!c.max_uses || used < c.max_uses);
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono font-medium">{c.code}</TableCell>
                    <TableCell>{c.kind === "flat" ? `₹${c.value}` : `${c.value}%`}{c.min_bill ? <div className="text-xs text-muted-foreground">bills of ₹{c.min_bill}+</div> : null}</TableCell>
                    <TableCell>{used}{c.max_uses ? ` / ${c.max_uses}` : ""}</TableCell>
                    <TableCell className="text-sm">{c.ends_on || "no end"}</TableCell>
                    <TableCell>{live ? <Badge>Running</Badge> : <Badge variant="secondary">{!c.is_active ? "Paused" : "Finished"}</Badge>}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="sm" variant="outline" className="h-7 mr-1" onClick={() => toggle(c)}>{c.is_active ? "Pause" : "Resume"}</Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Delete ${c.code}`} onClick={() => remove(c)}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
