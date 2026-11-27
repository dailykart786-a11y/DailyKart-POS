import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Minus, Plus, Search, ShoppingBag, Store } from "lucide-react";

interface Item { id: string; name: string; category: string | null; price: number; mrp: number | null; image_url: string | null; sold_by: string; in_stock: boolean; }
interface Shop { name: string; address: string | null; phone: string | null; whatsapp: string | null; note: string | null; }

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const unit = (i: Item) => (i.sold_by === "weight" ? " / kg" : i.sold_by === "volume" ? " / L" : "");
const step = (i: Item) => (i.sold_by === "piece" ? 1 : 0.5);
const waNumber = (p: string | null) => {
  const d = (p || "").replace(/\D/g, "");
  return d.length === 10 ? "91" + d : d;
};
const safeImage = (u: string | null) => (u && /^https:\/\//i.test(u) ? u : null);

/** Public product list for one store. Customers pick items and send the order on WhatsApp. No sign-in. */
export default function Catalogue() {
  const { slug = "" } = useParams();
  const [state, setState] = useState<"loading" | "ok" | "off" | "error">("loading");
  const [shop, setShop] = useState<Shop | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [who, setWho] = useState({ name: "", address: "", note: "" });

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("public_catalogue" as any, { p_slug: slug });
        if (!live) return;
        if (error) { setState(["PGRST202", "42501"].includes(error.code || "") ? "off" : "error"); return; }
        const d = data as any;
        if (!d || Array.isArray(d) || !d.store) { setState("off"); return; }
        setShop(d.store);
        setItems((d.products || []) as Item[]);
        setState("ok");
        document.title = `${d.store.name} · Order online`;
      } catch {
        if (live) setState("error");
      }
    })();
    return () => { live = false; };
  }, [slug]);

  const cats = useMemo(() => Array.from(new Set(items.map((i) => i.category).filter(Boolean))) as string[], [items]);
  const shown = items.filter((i) => (!cat || i.category === cat) && (!q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase())));
  const lines = items.filter((i) => cart[i.id] > 0);
  const total = lines.reduce((a, i) => a + i.price * cart[i.id], 0);
  const change = (i: Item, d: number) => setCart((c) => {
    const n = Math.max(0, Math.round(((c[i.id] || 0) + d) * 1000) / 1000);
    const next = { ...c };
    if (n > 0) next[i.id] = n; else delete next[i.id];
    return next;
  });

  const order = () => {
    if (!shop || !lines.length) return;
    const msg = [
      `Order for ${shop.name}`,
      "",
      ...lines.map((i, n) => `${n + 1}. ${i.name} × ${cart[i.id]}${unit(i).replace(" / ", " ")} = ${rupees(i.price * cart[i.id])}`),
      "",
      `Estimated total: ${rupees(total)}`,
      who.name.trim() ? `Name: ${who.name.trim()}` : null,
      who.address.trim() ? `Deliver to: ${who.address.trim()}` : "Pickup from the shop",
      who.note.trim() ? `Note: ${who.note.trim()}` : null,
    ].filter((l) => l !== null).join("\n");
    window.open(`https://wa.me/${waNumber(shop.whatsapp)}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
  };

  if (state === "loading") return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (state !== "ok" || !shop) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2 p-6 text-center">
        <Store className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">{state === "error" ? "Couldn't load the shop" : "This shop isn't taking online orders"}</h1>
        <p className="text-sm text-muted-foreground">{state === "error" ? "Check your internet and try again." : "Check the link with the shop."}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-secondary/30 pb-40">
      <header className="bg-background border-b py-4">
        <div className="max-w-5xl mx-auto px-4">
          <h1 className="text-2xl font-bold" data-no-translate>{shop.name}</h1>
          {shop.address && <p className="text-sm text-muted-foreground" data-no-translate>{shop.address}</p>}
          {shop.note && <p className="text-sm mt-1">{shop.note}</p>}
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
        </div>
        {cats.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            <Button size="sm" variant={cat ? "outline" : "default"} onClick={() => setCat(null)}>All</Button>
            {cats.map((c) => <Button key={c} size="sm" variant={cat === c ? "default" : "outline"} onClick={() => setCat(c)} data-no-translate>{c}</Button>)}
          </div>
        )}
        {shown.length === 0 ? <p className="text-center text-muted-foreground py-10">No products found</p> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {shown.map((i) => {
              const img = safeImage(i.image_url);
              const qty = cart[i.id] || 0;
              return (
                <div key={i.id} className={`rounded-lg border bg-background p-3 flex flex-col gap-2 ${i.in_stock ? "" : "opacity-60"}`}>
                  {img ? <img src={img} alt="" loading="lazy" className="h-28 w-full object-contain" /> : <div className="h-28 rounded bg-muted flex items-center justify-center"><ShoppingBag className="h-8 w-8 text-muted-foreground" /></div>}
                  <div className="text-sm font-medium leading-tight" data-no-translate>{i.name}</div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold">{rupees(i.price)}{unit(i)}</span>
                    {i.mrp && i.mrp > i.price && <span className="text-xs text-muted-foreground line-through">{rupees(i.mrp)}</span>}
                  </div>
                  {!i.in_stock ? <Badge variant="secondary" className="w-fit">Out of stock</Badge>
                    : qty === 0 ? <Button size="sm" onClick={() => change(i, step(i))}>Add</Button>
                    : (
                      <div className="flex items-center justify-between gap-1">
                        <Button size="icon" variant="outline" className="h-8 w-8" aria-label={`Less ${i.name}`} onClick={() => change(i, -step(i))}><Minus className="h-3 w-3" /></Button>
                        <span className="text-sm font-medium">{qty}{unit(i).replace(" / ", " ")}</span>
                        <Button size="icon" variant="outline" className="h-8 w-8" aria-label={`More ${i.name}`} onClick={() => change(i, step(i))}><Plus className="h-3 w-3" /></Button>
                      </div>
                    )}
                </div>
              );
            })}
          </div>
        )}
        {lines.length > 0 && (
          <section className="rounded-lg border bg-background p-4 space-y-3">
            <h2 className="font-semibold">Your details (optional)</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="cat-name">Name</Label><Input id="cat-name" value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="cat-addr">Delivery address (empty = pickup)</Label><Input id="cat-addr" value={who.address} onChange={(e) => setWho({ ...who, address: e.target.value })} /></div>
            </div>
            <div className="space-y-1"><Label htmlFor="cat-note">Note</Label><Textarea id="cat-note" rows={2} value={who.note} onChange={(e) => setWho({ ...who, note: e.target.value })} /></div>
          </section>
        )}
        <p className="text-xs text-muted-foreground text-center">Prices include GST. The shop confirms the final bill on WhatsApp.</p>
      </main>
      {lines.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 border-t bg-background p-3">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
            <div className="text-sm"><b>{lines.length}</b> item{lines.length > 1 ? "s" : ""} · <b>{rupees(total)}</b></div>
            <Button className="bg-green-600 hover:bg-green-700" onClick={order} disabled={!waNumber(shop.whatsapp)}>Send order on WhatsApp</Button>
          </div>
        </div>
      )}
    </div>
  );
}
