import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/hooks/useStore";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "@/hooks/use-toast";
import { Globe, Copy, ExternalLink } from "lucide-react";

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** Turn the public catalogue on or off, pick its link, and hide products from it. Hidden before the database update. */
export function CatalogueSettingsCard() {
  const { workingStoreId, stores } = useStore();
  const { role } = useUserRole();
  const canEdit = role === "admin" || role === "manager";
  const [ready, setReady] = useState(false);
  const [on, setOn] = useState(false);
  const [slug, setSlug] = useState("");
  const [wa, setWa] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ id: string; name: string; show_online: boolean }[]>([]);

  useEffect(() => {
    setReady(false);
    if (!canEdit || !workingStoreId) return;
    let live = true;
    supabase.from("locations").select("name, catalogue_enabled, catalogue_slug, catalogue_whatsapp, catalogue_note" as any).eq("id", workingStoreId).maybeSingle()
      .then(({ data, error }) => {
        if (!live || error || !data) return;
        const d = data as any;
        setOn(!!d.catalogue_enabled); setSlug(d.catalogue_slug || slugify(d.name || "")); setWa(d.catalogue_whatsapp || ""); setNote(d.catalogue_note || "");
        setReady(true);
      }, () => undefined);
    return () => { live = false; };
  }, [workingStoreId, canEdit]);

  useEffect(() => {
    if (!ready || q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("products").select("id, name, show_online" as any).eq("location_id", workingStoreId!).ilike("name", `%${q.trim()}%`).order("name").limit(20);
      setFound(((data || []) as any[]).map((p) => ({ id: p.id, name: p.name, show_online: p.show_online !== false })));
    }, 300);
    return () => clearTimeout(t);
  }, [q, ready, workingStoreId]);

  if (!ready) return null;
  const link = `${window.location.origin}/shop/${slug}`;
  const save = async () => {
    if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) { toast({ title: "Link name: 3 to 40 small letters, numbers or -", variant: "destructive" }); return; }
    const digits = wa.replace(/\D/g, "");
    if (on && digits.length < 10) { toast({ title: "Add the WhatsApp number that receives orders", variant: "destructive" }); return; }
    setBusy(true);
    const { error } = await supabase.from("locations").update({ catalogue_enabled: on, catalogue_slug: slug, catalogue_whatsapp: digits || null, catalogue_note: note.trim() || null } as any).eq("id", workingStoreId!);
    setBusy(false);
    if (error) {
      toast({ title: "Not saved", description: /uq_locations_catalogue_slug|duplicate/.test(error.message) ? "Another store already uses this link name" : error.message, variant: "destructive" });
      return;
    }
    toast({ title: on ? "Online catalogue is on" : "Online catalogue is off" });
  };
  const toggle = async (id: string, show: boolean) => {
    setFound((f) => f.map((p) => (p.id === id ? { ...p, show_online: show } : p)));
    const { error } = await supabase.from("products").update({ show_online: show } as any).eq("id", id);
    if (error) { toast({ title: "Not changed", description: error.message, variant: "destructive" }); setFound((f) => f.map((p) => (p.id === id ? { ...p, show_online: !show } : p))); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast({ title: "Link copied" }); } catch { toast({ title: link }); } };
  const storeName = stores.find((s) => s.id === workingStoreId)?.name;

  return (
    <Card className="mt-6">
      <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Globe className="h-5 w-5" /> Online catalogue{storeName ? ` · ${storeName}` : ""}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">A web page with your products, prices (with GST) and in stock / out of stock. Customers pick items and the order comes to your WhatsApp. Cost prices and stock counts are never shown.</p>
        <div className="flex items-center gap-2"><Switch id="cat-on" checked={on} onCheckedChange={setOn} /><Label htmlFor="cat-on">Take orders online</Label></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="cat-slug">Link name</Label><Input id="cat-slug" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} placeholder="e.g. dailykart-kukatpally" /></div>
          <div className="space-y-1"><Label htmlFor="cat-wa">WhatsApp number for orders</Label><Input id="cat-wa" inputMode="tel" value={wa} onChange={(e) => setWa(e.target.value)} placeholder="e.g. 98xxxxxx10" /></div>
        </div>
        <div className="space-y-1"><Label htmlFor="cat-note">Line under the shop name (optional)</Label><Input id="cat-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Free home delivery above ₹500, 9 am to 9 pm" /></div>
        <Button onClick={save} disabled={busy}>Save catalogue settings</Button>
        {on && slug && (
          <div className="flex flex-wrap items-center gap-4 rounded-md border p-3">
            <QRCodeSVG value={link} size={96} />
            <div className="space-y-2 text-sm">
              <div className="break-all font-mono" data-no-translate>{link}</div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="gap-1" onClick={copy}><Copy className="h-3 w-3" /> Copy link</Button>
                <Button size="sm" variant="outline" className="gap-1" asChild><a href={link} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3 w-3" /> Open</a></Button>
              </div>
              <p className="text-xs text-muted-foreground">Print the QR code for the counter, or share the link on WhatsApp status.</p>
            </div>
          </div>
        )}
        <div className="space-y-2 border-t pt-3">
          <Label htmlFor="cat-find">Hide a product from the catalogue</Label>
          <Input id="cat-find" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a product name" />
          {found.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={p.show_online} onCheckedChange={(v) => toggle(p.id, v === true)} aria-label={`Show ${p.name} online`} />
              <span data-no-translate>{p.name}</span>{!p.show_online && <span className="text-xs text-muted-foreground">(hidden)</span>}
            </label>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
