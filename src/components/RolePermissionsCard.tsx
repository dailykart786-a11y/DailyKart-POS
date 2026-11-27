import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { DEFAULT_PERMISSIONS, EDITABLE_ROLES, PERMISSIONS, roleLabel } from "@/lib/roles";
import { ShieldCheck } from "lucide-react";

type Matrix = Record<string, Set<string>>;

/** Owner screen: tick what each role can open. Saved in role_permissions. */
export function RolePermissionsCard() {
  const [saved, setSaved] = useState<Matrix | null>(null);
  const [draft, setDraft] = useState<Matrix | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inDb, setInDb] = useState<Set<string>>(new Set());

  const load = async () => {
    const { data, error } = await supabase.from("role_permissions" as any).select("role, permission");
    if (error) { setMissing(true); return; }
    const m: Matrix = Object.fromEntries(EDITABLE_ROLES.map((r) => [r, new Set<string>()]));
    for (const row of (data || []) as any[]) m[row.role]?.add(row.permission);
    setInDb(new Set(EDITABLE_ROLES.filter((r) => m[r].size > 0)));
    // A role with nothing saved uses the defaults
    for (const r of EDITABLE_ROLES) if (m[r].size === 0) m[r] = new Set(DEFAULT_PERMISSIONS[r]);
    setSaved(m);
    setDraft(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, new Set(v)])));
  };

  useEffect(() => { load(); }, []);

  if (missing) {
    return (
      <Card><CardContent className="py-6 text-center text-muted-foreground">
        Roles & permissions need a database update. Run the latest dailykart-updates.sql in Supabase.
      </CardContent></Card>
    );
  }
  if (!draft || !saved) return null;

  const toggle = (role: string, perm: string, on: boolean) => {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, [role]: new Set(d[role]) };
      if (on) next[role].add(perm); else next[role].delete(perm);
      return next;
    });
  };

  const changed = EDITABLE_ROLES.some((r) => saved[r].size !== draft[r].size || [...draft[r]].some((p) => !saved[r].has(p)));

  const save = async () => {
    if (draft.cashier.size === 0 || !draft.cashier.has("sales")) {
      toast({ title: "Cashiers need Billing", description: "Keep Billing ticked for cashiers", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      for (const role of EDITABLE_ROLES) {
        // A role still on the defaults gets its whole list saved
        const add = [...draft[role]].filter((p) => !inDb.has(role) || !saved[role].has(p)).map((permission) => ({ role, permission }));
        const remove = [...saved[role]].filter((p) => !draft[role].has(p));
        if (add.length) {
          const { error } = await supabase.from("role_permissions" as any).upsert(add as any, { onConflict: "role,permission", ignoreDuplicates: true } as any);
          if (error) throw error;
        }
        if (remove.length) {
          const { error } = await supabase.from("role_permissions" as any).delete().eq("role", role).in("permission", remove);
          if (error) throw error;
        }
      }
      toast({ title: "Permissions saved", description: "Staff see the change the next time they open the app" });
      await load();
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message || "Failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Roles & permissions</CardTitle></CardHeader>
      <CardContent className="space-y-3 overflow-x-auto">
        <p className="text-sm text-muted-foreground">Tick what each role can open and do. The owner (admin) can always do everything, and only the owner manages users.</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Area</TableHead>
              {EDITABLE_ROLES.map((r) => <TableHead key={r} className="text-center">{roleLabel(r)}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {PERMISSIONS.map((p) => (
              <TableRow key={p.key}>
                <TableCell>{p.label}</TableCell>
                {EDITABLE_ROLES.map((r) => (
                  <TableCell key={r} className="text-center">
                    <Checkbox aria-label={`${roleLabel(r)}: ${p.label}`} checked={draft[r].has(p.key)} onCheckedChange={(v) => toggle(r, p.key, !!v)} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex gap-2">
          <Button onClick={save} disabled={!changed || busy}>Save permissions</Button>
          {changed && <Button variant="ghost" onClick={load}>Undo changes</Button>}
        </div>
      </CardContent>
    </Card>
  );
}
