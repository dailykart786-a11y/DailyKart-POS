import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "@/hooks/use-toast";
import { Save, Store } from "lucide-react";
import { getMyLocationId, INDIAN_STATES, isValidGstin } from "@/lib/invoice";

// Shop name, address, GSTIN and state printed on every bill.
export function StoreDetailsSettings() {
  const { user } = useAuth();
  const { role } = useUserRole();
  const [locationId, setLocationId] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    business_name: "", address: "", phone: "", email: "", gstin: "", state_code: "", bill_footer: "", invoice_prefix: "DK",
  });

  const canEdit = role === "admin" || role === "manager";

  useEffect(() => {
    if (!user || !canEdit) { setLoading(false); return; }
    (async () => {
      try {
        const id = await getMyLocationId(user.id);
        setLocationId(id);
        if (!id) return;
        const { data, error } = await supabase.from("locations").select("*").eq("id", id).maybeSingle();
        if (error) throw error;
        const row = (data || {}) as Record<string, any>;
        if (!("gstin" in row)) { setAvailable(false); return; }
        setForm({
          business_name: row.business_name || "",
          address: row.address || "",
          phone: row.phone || "",
          email: row.email || "",
          gstin: row.gstin || "",
          state_code: row.state_code || "",
          bill_footer: row.bill_footer || "",
          invoice_prefix: row.invoice_prefix || "DK",
        });
      } catch (e) {
        console.error("Failed to load shop details", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [user, canEdit]);

  if (!canEdit || loading) return null;

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!locationId) return;
    const gstin = form.gstin.trim().toUpperCase();
    if (gstin && !isValidGstin(gstin)) {
      toast({ title: "Check GSTIN", description: "GSTIN should be 15 characters, like 36ABCDE1234F1Z5", variant: "destructive" });
      return;
    }
    if (gstin && form.state_code && gstin.slice(0, 2) !== form.state_code) {
      toast({ title: "Check state", description: "The first 2 digits of the GSTIN should match the state code", variant: "destructive" });
      return;
    }
    const prefix = form.invoice_prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "DK";
    setSaving(true);
    try {
      const { error } = await supabase
        .from("locations")
        .update({
          business_name: form.business_name.trim() || null,
          address: form.address.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          gstin: gstin || null,
          state_code: form.state_code || null,
          bill_footer: form.bill_footer.trim() || null,
          invoice_prefix: prefix,
        } as any)
        .eq("id", locationId);
      if (error) throw error;
      setForm((f) => ({ ...f, gstin, invoice_prefix: prefix }));
      toast({ title: "Saved", description: "Shop details will appear on new bills" });
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message || "Failed to save shop details", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Store className="h-5 w-5" />
          Shop details on bills
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!available ? (
          <p className="text-sm text-muted-foreground">
            The database needs the GST update before shop details can be saved. Ask your admin to run the step 3 SQL.
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="sd-name">Shop name</Label>
                <Input id="sd-name" value={form.business_name} onChange={(e) => set("business_name")(e.target.value)} placeholder="DailyKart Supermarket" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sd-gstin">GSTIN</Label>
                <Input id="sd-gstin" value={form.gstin} onChange={(e) => set("gstin")(e.target.value.toUpperCase())} placeholder="36ABCDE1234F1Z5" maxLength={15} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="sd-address">Address</Label>
                <Input id="sd-address" value={form.address} onChange={(e) => set("address")(e.target.value)} placeholder="Shop no, street, city, PIN" />
              </div>
              <div className="space-y-2">
                <Label>State</Label>
                <Select value={form.state_code} onValueChange={set("state_code")}>
                  <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                  <SelectContent>
                    {INDIAN_STATES.map((s) => (
                      <SelectItem key={s.code} value={s.code}>{s.code} - {s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sd-phone">Phone</Label>
                <Input id="sd-phone" value={form.phone} onChange={(e) => set("phone")(e.target.value)} placeholder="+91-..." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sd-email">Email</Label>
                <Input id="sd-email" value={form.email} onChange={(e) => set("email")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sd-prefix">Bill number prefix</Label>
                <Input id="sd-prefix" value={form.invoice_prefix} onChange={(e) => set("invoice_prefix")(e.target.value)} maxLength={6} />
                <p className="text-xs text-muted-foreground">Bills look like {(form.invoice_prefix || "DK").toUpperCase()}/26-27/0001</p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="sd-footer">Message at bottom of bill</Label>
                <Input id="sd-footer" value={form.bill_footer} onChange={(e) => set("bill_footer")(e.target.value)} placeholder="Thank you! No returns without bill." />
              </div>
            </div>
            <Button onClick={save} disabled={saving} className="gap-2">
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : "Save shop details"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
