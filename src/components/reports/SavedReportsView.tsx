// Saved reports: a localStorage-backed manager of saved report configurations.
// No database migration required: reads/writes are kept on this device, per
// signed-in user, so a live app is not affected.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, RefreshCw, Clock, FolderKanban, Plus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/hooks/useStore";
import { toast } from "@/hooks/use-toast";
import { CATEGORIES, findReport } from "@/lib/reports/catalog";
import { ReportCtx } from "./context";
import { rangeLabel } from "@/lib/reports/dates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface SavedReport {
  id: string;
  reportId: string;
  title: string;
  name: string | null;
  from: string;
  to: string;
  storeId: string | null;
  storeName: string | null;
  compareKey: string | null;
  savedAt: string;
}

function keyFor(userId: string | undefined) {
  return `dailykart-saved-reports-${userId || "anon"}`;
}

function readSaved(userId: string | undefined): SavedReport[] {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeSaved(userId: string | undefined, list: SavedReport[]) {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(list));
    window.dispatchEvent(new Event("dailykart-saved-reports"));
  } catch {
    // storage blocked (private mode): saves silently fail but the app still works
  }
}

export function SavedReportsView({ ctx }: { ctx: ReportCtx }) {
  const { user } = useAuth();
  const { stores } = useStore();
  const [list, setList] = useState<SavedReport[]>([]);
  const [loading, setLoading] = useState(true);

  // Report options: every report that isn't still "coming soon" (no phase).
  const reportOptions = useMemo(() => {
    const opts: { id: string; title: string }[] = [];
    for (const c of CATEGORIES) {
      for (const r of c.reports) {
        if (!r.phase) opts.push({ id: r.id, title: `${c.title} › ${r.title}` });
      }
    }
    return opts;
  }, []);

  const [draft, setDraft] = useState<{
    reportId: string;
    name: string;
    from: string;
    to: string;
    storeId: string | null;
  }>({ reportId: "", name: "", from: "", to: "", storeId: null });

  useEffect(() => {
    setList(readSaved(user?.id));
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    const on = () => setList(readSaved(user?.id));
    window.addEventListener("dailykart-saved-reports", on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener("dailykart-saved-reports", on);
      window.removeEventListener("storage", on);
    };
  }, [user?.id]);

  const saveReport = () => {
    if (!draft.reportId) {
      toast({ title: "Pick a report", variant: "destructive" });
      return;
    }
    if (!draft.from || !draft.to) {
      toast({ title: "Pick the dates", variant: "destructive" });
      return;
    }
    const report = findReport(draft.reportId);
    const store = stores.find((s) => s.id === draft.storeId);
    const entry: SavedReport = {
      id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`,
      reportId: draft.reportId,
      title: report?.title || draft.reportId,
      name: draft.name.trim() || null,
      from: draft.from,
      to: draft.to,
      storeId: draft.storeId,
      storeName: store?.name || null,
      compareKey: null,
      savedAt: new Date().toISOString(),
    };
    const next = [entry, ...list];
    writeSaved(user?.id, next);
    setList(next);
    setDraft({ reportId: "", name: "", from: "", to: "", storeId: null });
    toast({ title: "Report saved", description: `${entry.title} saved under "${entry.name || entry.title}"` });
  };

  const removeReport = (id: string) => {
    const next = list.filter((r) => r.id !== id);
    writeSaved(user?.id, next);
    setList(next);
    toast({ title: "Saved report removed" });
  };

  const clearAll = () => {
    if (!window.confirm("Remove all saved reports?")) return;
    writeSaved(user?.id, []);
    setList([]);
    toast({ title: "Cleared" });
  };

  const openReport = (r: SavedReport) => {
    ctx.open(r.reportId);
    toast({
      title: `Opening ${r.title}`,
      description: "Set the dates on the report page and press Generate.",
    });
  };

  if (loading) return <div className="text-muted-foreground">Loading saved reports…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FolderKanban className="h-6 w-6" /> Saved reports
        </h1>
        <p className="text-muted-foreground">
          Reports you saved, with their dates and store. Open one to go straight to that report.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Save a report</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4 items-end">
            <div className="space-y-1">
              <Label>Report</Label>
              <Select value={draft.reportId} onValueChange={(v) => setDraft({ ...draft, reportId: v })}>
                <SelectTrigger className="w-full" aria-label="Report">
                  <SelectValue placeholder="Pick a report" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">— pick a report —</SelectItem>
                  {reportOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Name (optional)</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Monthly sales January"
              />
            </div>
            <div className="space-y-1">
              <Label>From</Label>
              <Input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <Input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Store</Label>
              <Select value={draft.storeId || ""} onValueChange={(v) => setDraft({ ...draft, storeId: v || null })}>
                <SelectTrigger className="w-full" aria-label="Store">
                  <SelectValue placeholder="All stores" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All stores</SelectItem>
                  {stores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={saveReport}
              disabled={!draft.reportId || !draft.from || !draft.to}
              className="gap-2"
            >
              <Plus className="h-4 w-4" /> Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle className="text-lg">Saved reports</CardTitle>
          {list.length > 0 ? (
            <Button variant="destructive" size="sm" onClick={clearAll} className="hidden sm:block">
              <Trash2 className="h-4 w-4" /> Clear all
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No saved reports yet. Save one above to reopen it later.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Report</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead className="text-right">Saved</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((r) => {
                    const rep = findReport(r.reportId);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{rep?.title || r.reportId}</TableCell>
                        <TableCell>{r.name || "—"}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{rangeLabel({ from: r.from, to: r.to })}</TableCell>
                        <TableCell className="text-sm">{r.storeName || "All stores"}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(r.savedAt).toLocaleString("en-IN", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap space-x-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 mr-1 gap-1"
                            onClick={() => openReport(r)}
                          >
                            <RefreshCw className="h-3.5 w-3.5" /> Open
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 w-7 gap-0"
                            aria-label={`Remove ${r.name || r.title}`}
                            onClick={() => removeReport(r.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
