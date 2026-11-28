import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useStore, inStore } from "@/hooks/useStore";
import { toast } from "@/hooks/use-toast";
import { Offer, isOfferLive, offerText } from "@/lib/offers";
import { CouponsCard, DiscountRulesCard } from "@/components/DiscountSettings";
import { todayIso } from "@/lib/batches";
import { BadgePercent, Save, Star, Trash2 } from "lucide-react";

interface LoyaltySettings {
  loyalty_enabled: boolean;
  loyalty_earn_per_100: string;
  loyalty_point_value: string;
  loyalty_min_redeem: string;
}

export default function Offers() {
  const { filterStoreId, workingStoreId, isAdmin, newRecordFields, stores } = useStore();
  const [missing, setMissing] = useState(false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string; category: string | null }[]>([]);
  const [settings, setSettings] = useState<LoyaltySettings | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [percent, setPercent] = useState("");
  const [kind, setKind] = useState<"percent" | "flat" | "bxgy">("percent");
  const [flat, setFlat] = useState("");
  const [buyQty, setBuyQty] = useState("2");
  const [getQty, setGetQty] = useState("1");
  const [minBill, setMinBill] = useState("");
  const [scope, setScope] = useState<"all" | "category" | "product">("category");
  const [category, setCategory] = useState("");
  const [productName, setProductName] = useState("");
  const [minQty, setMinQty] = useState("1");
  const [starts, setStarts] = useState(todayIso());
  const [ends, setEnds] = useState("");

  const needsStore = isAdmin && !filterStoreId && stores.length > 1;
  const storeId = workingStoreId;

  const load = async () => {
    const [oRes, pRes, lRes] = await Promise.all([
      inStore(supabase.from("offers" as any).select("*"), filterStoreId).order("created_at", { ascending: false }),
      inStore(supabase.from("products").select("id, name, category").eq("is_active", true), filterStoreId).order("name"),
      storeId
        ? supabase.from("locations").select("loyalty_enabled, loyalty_earn_per_100, loyalty_point_value, loyalty_min_redeem" as any).eq("id", storeId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (oRes.error || lRes.error) { setMissing(true); return; }
    setMissing(false);
    setOffers(((oRes.data || []) as any[]).map((o) => ({ ...o, percent: o.percent == null ? null : Number(o.percent) })));
    setProducts((pRes.data || []) as any);
    const l = lRes.data as any;
    setSettings(l ? {
      loyalty_enabled: !!l.loyalty_enabled,
      loyalty_earn_per_100: String(l.loyalty_earn_per_100 ?? 1),
      loyalty_point_value: String(l.loyalty_point_value ?? 1),
      loyalty_min_redeem: String(l.loyalty_min_redeem ?? 50),
    } : null);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStoreId, storeId]);

  const categories = Array.from(new Set(products.map((p) => (p.category || "").trim()).filter(Boolean))).sort();
  const today = todayIso();

  const saveSettings = async () => {
    if (!settings || !storeId) return;
    const earn = parseFloat(settings.loyalty_earn_per_100);
    const value = parseFloat(settings.loyalty_point_value);
    const min = parseInt(settings.loyalty_min_redeem, 10);
    if (!(earn >= 0) || !(value >= 0) || !(min >= 0)) { toast({ title: "Check the numbers", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from("locations").update({
        loyalty_enabled: settings.loyalty_enabled, loyalty_earn_per_100: earn, loyalty_point_value: value, loyalty_min_redeem: min,
      } as any).eq("id", storeId);
      if (error) throw error;
      toast({ title: "Loyalty settings saved", description: settings.loyalty_enabled ? "Customers now earn points on bills" : "Loyalty points are off" });
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message || "Failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const addOffer = async () => {
    const pct = parseFloat(percent);
    const flatAmt = parseFloat(flat);
    const b = parseInt(buyQty, 10), g = parseInt(getQty, 10);
    const mb = minBill.trim() ? parseFloat(minBill) : null;
    if (!name.trim()) { toast({ title: "Give the offer a name", variant: "destructive" }); return; }
    if (kind === "percent" && !(pct > 0 && pct <= 90)) { toast({ title: "Discount should be between 1% and 90%", variant: "destructive" }); return; }
    if (kind === "flat" && !(flatAmt > 0)) { toast({ title: "Enter the rupees off each piece", variant: "destructive" }); return; }
    if (kind === "bxgy" && !(b >= 1 && g >= 1)) { toast({ title: "Enter how many to buy and how many free", variant: "destructive" }); return; }
    if (mb != null && !(mb >= 0)) { toast({ title: "Check the minimum bill", variant: "destructive" }); return; }
    const product = scope === "product" ? products.find((p) => p.name.toLowerCase() === productName.trim().toLowerCase()) : null;
    if (scope === "product" && !product) { toast({ title: "Pick a product from the list", variant: "destructive" }); return; }
    if (scope === "category" && !category) { toast({ title: "Pick a category", variant: "destructive" }); return; }
    if (ends && starts && ends < starts) { toast({ title: "End date is before the start date", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const typeFields: Record<string, any> = kind === "percent" && mb == null ? { percent: pct }
        : { offer_type: kind, percent: kind === "percent" ? pct : null, flat_amount: kind === "flat" ? flatAmt : null,
            buy_qty: kind === "bxgy" ? b : null, get_qty: kind === "bxgy" ? g : null, min_bill: mb };
      const { error } = await supabase.from("offers" as any).insert({
        name: name.trim(), ...typeFields,
        product_id: product?.id || null,
        category: scope === "category" ? category : null,
        min_qty: Math.max(1, parseInt(minQty, 10) || 1),
        starts_on: starts || null, ends_on: ends || null,
        ...newRecordFields,
      } as any);
      if (error) {
        if (/offer_type|flat_amount|min_bill|buy_qty/.test(error.message || "")) throw new Error("This kind of offer needs the latest database update. Plain % offers work now.");
        throw error;
      }
      toast({ title: "Offer added", description: name.trim() });
      setName(""); setPercent(""); setFlat(""); setMinBill(""); setProductName(""); setMinQty("1"); setEnds("");
      load();
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message || "Failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const toggleOffer = async (o: Offer) => {
    const { error } = await supabase.from("offers" as any).update({ is_active: !o.is_active } as any).eq("id", o.id);
    if (error) toast({ title: "Not saved", description: error.message, variant: "destructive" });
    load();
  };
  const deleteOffer = async (o: Offer) => {
    const { error } = await supabase.from("offers" as any).delete().eq("id", o.id);
    if (error) toast({ title: "Not deleted", description: error.message, variant: "destructive" });
    load();
  };

  const target = (o: Offer) => o.product_id ? (products.find((p) => p.id === o.product_id)?.name || "A product")
    : o.category ? `All ${o.category}` : "Whole shop";

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BadgePercent className="h-6 w-6" /> Offers & loyalty</h1>
          <p className="text-muted-foreground">Automatic discounts at the counter, coupons, discount limits, and points for regular customers</p>
        </div>

        {missing ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">
            Offers and loyalty need a database update. Ask your admin to run the latest dailykart-updates.sql in Supabase.
          </CardContent></Card>
        ) : needsStore ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">Pick a store at the top of the screen first.</CardContent></Card>
        ) : (
          <>
            {settings && (
              <Card>
                <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Star className="h-5 w-5" /> Loyalty points</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Switch id="loy-on" checked={settings.loyalty_enabled} onCheckedChange={(v) => setSettings({ ...settings, loyalty_enabled: v })} />
                    <Label htmlFor="loy-on">Customers earn points on every bill</Label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="loy-earn">Points for every ₹100</Label>
                      <Input id="loy-earn" inputMode="decimal" value={settings.loyalty_earn_per_100} onChange={(e) => setSettings({ ...settings, loyalty_earn_per_100: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="loy-value">1 point is worth (₹)</Label>
                      <Input id="loy-value" inputMode="decimal" value={settings.loyalty_point_value} onChange={(e) => setSettings({ ...settings, loyalty_point_value: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="loy-min">Can use from (points)</Label>
                      <Input id="loy-min" inputMode="numeric" value={settings.loyalty_min_redeem} onChange={(e) => setSettings({ ...settings, loyalty_min_redeem: e.target.value })} />
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Example: with 1 point per ₹100 and 1 point = ₹1, a customer who spends ₹5,000 gets 50 points, which is ₹50 off a later bill
                    (up to half of that bill). Points count from the day this update was installed, less any returns.
                  </p>
                  <Button onClick={saveSettings} disabled={busy} className="gap-2"><Save className="h-4 w-4" /> Save loyalty settings</Button>
                </CardContent>
              </Card>
            )}

            {storeId && <DiscountRulesCard storeId={storeId} />}
            {storeId && <CouponsCard storeId={storeId} />}

            <Card>
              <CardHeader><CardTitle className="text-lg">New offer</CardTitle></CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-4 items-end">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="of-name">Name (shown on the bill screen)</Label>
                  <Input id="of-name" placeholder="e.g. Diwali 10% off sweets" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Kind</Label>
                  <Select value={kind} onValueChange={(v: any) => setKind(v)}>
                    <SelectTrigger aria-label="Kind of offer"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">% off</SelectItem>
                      <SelectItem value="flat">₹ off each piece</SelectItem>
                      <SelectItem value="bxgy">Buy X get Y free</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {kind === "percent" && (
                  <div className="space-y-2">
                    <Label htmlFor="of-pct">Discount %</Label>
                    <Input id="of-pct" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
                  </div>
                )}
                {kind === "flat" && (
                  <div className="space-y-2">
                    <Label htmlFor="of-flat">₹ off each piece</Label>
                    <Input id="of-flat" inputMode="decimal" value={flat} onChange={(e) => setFlat(e.target.value)} />
                  </div>
                )}
                {kind === "bxgy" && (
                  <div className="space-y-2">
                    <Label>Buy / get free</Label>
                    <div className="flex gap-2 items-center">
                      <Input aria-label="Buy" inputMode="numeric" value={buyQty} onChange={(e) => setBuyQty(e.target.value)} />
                      <span className="text-sm">+</span>
                      <Input aria-label="Get free" inputMode="numeric" value={getQty} onChange={(e) => setGetQty(e.target.value)} />
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>On</Label>
                  <Select value={scope} onValueChange={(v: any) => setScope(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="category">A category</SelectItem>
                      <SelectItem value="product">One product</SelectItem>
                      <SelectItem value="all">Whole shop</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {scope === "category" && (
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Category</Label>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger><SelectValue placeholder={categories.length ? "Pick category" : "No categories on products yet"} /></SelectTrigger>
                      <SelectContent>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                {scope === "product" && (
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="of-prod">Product</Label>
                    <Input id="of-prod" list="offer-products" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Type product name" />
                    <datalist id="offer-products">{products.map((p) => <option key={p.id} value={p.name} />)}</datalist>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="of-min">When buying at least</Label>
                  <Input id="of-min" inputMode="numeric" value={minQty} onChange={(e) => setMinQty(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="of-minbill">Only on bills of at least ₹ (optional)</Label>
                  <Input id="of-minbill" inputMode="decimal" value={minBill} onChange={(e) => setMinBill(e.target.value)} placeholder="Any bill" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="of-from">From</Label>
                  <Input id="of-from" type="date" value={starts} onChange={(e) => setStarts(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="of-to">Until (optional)</Label>
                  <Input id="of-to" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />
                </div>
                <Button onClick={addOffer} disabled={busy} className="gap-2"><Save className="h-4 w-4" /> Add offer</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-lg">Offers</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                {offers.length === 0 ? (
                  <p className="text-muted-foreground py-6 text-center">No offers yet. The best running offer is put on a bill line automatically.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Offer</TableHead>
                        <TableHead>On</TableHead>
                        <TableHead className="text-right">Off</TableHead>
                        <TableHead>Dates</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {offers.map((o) => (
                        <TableRow key={o.id}>
                          <TableCell className="font-medium">{o.name}{o.min_qty > 1 ? <div className="text-xs text-muted-foreground">Buy {o.min_qty} or more</div> : null}</TableCell>
                          <TableCell>{target(o)}</TableCell>
                          <TableCell className="text-right">{offerText(o)}</TableCell>
                          <TableCell className="text-sm">{o.starts_on || "—"} to {o.ends_on || "no end"}</TableCell>
                          <TableCell>
                            {isOfferLive(o, today) ? <Badge>Running</Badge>
                              : !o.is_active ? <Badge variant="secondary">Paused</Badge>
                              : o.ends_on && o.ends_on < today ? <Badge variant="secondary">Ended</Badge>
                              : <Badge variant="outline">Starts {o.starts_on}</Badge>}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <Button size="sm" variant="outline" className="h-7 mr-1" onClick={() => toggleOffer(o)}>{o.is_active ? "Pause" : "Resume"}</Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Delete ${o.name}`} onClick={() => deleteOffer(o)}><Trash2 className="h-4 w-4" /></Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
