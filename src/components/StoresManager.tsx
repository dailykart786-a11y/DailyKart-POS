import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useStore } from "@/hooks/useStore";
import { Store, Plus, Save } from "lucide-react";

// Admin-only list of stores: add a store or rename one.
// Stores are never deleted here, so no bills or stock can be lost.
export function StoresManager() {
  const { stores, isAdmin, reloadStores } = useStore();
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (!isAdmin) return null;

  const addStore = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("locations").insert({ name, address: newAddress.trim() || null });
      if (error) throw error;
      setNewName("");
      setNewAddress("");
      await reloadStores();
      toast({ title: "Store added", description: `${name} is ready. Assign staff to it from Edit User.` });
    } catch (e: any) {
      const duplicate = /duplicate|unique/i.test(e?.message || "");
      toast({ title: "Not added", description: duplicate ? "A store with this name already exists" : e?.message || "Failed to add store", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const rename = async (id: string) => {
    const name = (edits[id] || "").trim();
    if (!name) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("locations").update({ name }).eq("id", id);
      if (error) throw error;
      setEdits((e) => { const n = { ...e }; delete n[id]; return n; });
      await reloadStores();
      toast({ title: "Store renamed" });
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message || "Failed to rename store", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Store className="h-5 w-5" />
          Stores
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {stores.map((s) => (
            <div key={s.id} className="flex gap-2 items-center">
              <Input
                value={edits[s.id] ?? s.name}
                onChange={(e) => setEdits((x) => ({ ...x, [s.id]: e.target.value }))}
                aria-label={`Name of ${s.name}`}
              />
              {edits[s.id] !== undefined && edits[s.id].trim() !== s.name && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => rename(s.id)} className="gap-1">
                  <Save className="h-4 w-4" /> Save
                </Button>
              )}
            </div>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] border-t pt-4">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New store name" />
          <Input value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder="Address (optional)" />
          <Button onClick={addStore} disabled={busy || !newName.trim()} className="gap-1">
            <Plus className="h-4 w-4" /> Add store
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Each store has its own products, stock, customers, expenses and bills. Use the store picker at the top to switch.
        </p>
      </CardContent>
    </Card>
  );
}
