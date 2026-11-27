import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import {
  QUEUE_EVENT, QueuedSale, offlineBillNumber, readQueue, removeFromQueue, syncOfflineSales,
} from "@/lib/offline";
import { CloudOff, RefreshCw, AlertTriangle } from "lucide-react";

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Count of this user's bills still waiting on the device. */
export function usePendingOfflineSales() {
  const { user } = useAuth();
  const [queue, setQueue] = useState<QueuedSale[]>(() => readQueue());
  useEffect(() => {
    const update = () => setQueue(readQueue());
    window.addEventListener(QUEUE_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(QUEUE_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return user ? queue.filter((s) => s.cashier_id === user.id) : [];
}

export function OfflineStatus() {
  const { user } = useAuth();
  const { role } = useUserRole();
  const mine = usePendingOfflineSales();
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  const [syncing, setSyncing] = useState(false);
  const [open, setOpen] = useState(false);
  const [discard, setDiscard] = useState<QueuedSale | null>(null);

  const sync = useCallback(async (manual = false) => {
    if (!user || !readQueue().some((s) => s.cashier_id === user.id)) return;
    setSyncing(true);
    try {
      const r = await syncOfflineSales(user.id);
      if (r.synced > 0) toast({ title: "Offline bills saved", description: `${r.synced} bill${r.synced === 1 ? "" : "s"} sent to the database` });
      if (manual && r.failed > 0) toast({ title: "Some bills could not be saved", description: "Open the list to see why", variant: "destructive" });
      if (manual && r.needsDbUpdate) toast({ title: "Database update needed", description: "Ask your admin to run the latest dailykart-updates.sql", variant: "destructive" });
    } catch (e) {
      console.warn("Offline sync failed", e);
    } finally {
      setSyncing(false);
    }
  }, [user]);

  useEffect(() => {
    const goOnline = () => { setOnline(true); sync(); };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    sync();
    const t = window.setInterval(() => { if (navigator.onLine !== false) sync(); }, 60_000);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.clearInterval(t);
    };
  }, [sync]);

  if (online && mine.length === 0) return null;

  const failed = mine.filter((s) => s.last_error);
  const canDiscard = role === "manager" || role === "admin";

  return (
    <>
      <div className={`flex flex-wrap items-center gap-2 px-4 md:px-6 py-2 text-sm border-b ${online ? (failed.length ? "bg-destructive/10" : "bg-accent/40") : "bg-warning/20"}`}>
        {!online ? (
          <span className="flex items-center gap-2 font-medium"><CloudOff className="h-4 w-4" /> No internet. You can keep billing; bills are kept on this device.</span>
        ) : failed.length ? (
          <span className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> {failed.length} offline bill{failed.length === 1 ? "" : "s"} could not be saved</span>
        ) : null}
        {mine.length > 0 && (
          <>
            <span>{mine.length} bill{mine.length === 1 ? "" : "s"} waiting to sync</span>
            <Button size="sm" variant="outline" className="h-7" onClick={() => setOpen(true)}>View</Button>
            {online && (
              <Button size="sm" variant="outline" className="h-7 gap-1" disabled={syncing} onClick={() => sync(true)}>
                <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} /> Sync now
              </Button>
            )}
          </>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Bills waiting to sync</DialogTitle>
            <DialogDescription>
              These bills were made without internet. They get their real bill number when they reach the database.
              Don't clear this browser's data until they are synced.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {mine.length === 0 && <p className="text-muted-foreground text-sm">All bills are synced.</p>}
            {mine.map((s) => (
              <div key={s.client_ref} className="rounded border p-3 text-sm space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{offlineBillNumber(s.client_ref)}</span>
                  <span className="font-semibold">{rupees(s.expected_total)}</span>
                </div>
                <div className="text-muted-foreground">
                  {new Date(s.sold_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {s.payment_method}
                </div>
                <div>{s.lines.map((l) => `${l.name} × ${l.quantity}`).join(", ")}</div>
                {s.last_error && (
                  <div className="text-destructive">
                    {s.last_error}
                    {/stock/i.test(s.last_error) && <div className="text-xs text-muted-foreground">Fix the count on the Stock page (stock count), then press Sync now.</div>}
                  </div>
                )}
                {canDiscard && s.last_error && (
                  <Button size="sm" variant="ghost" className="h-7 text-destructive px-2" onClick={() => setDiscard(s)}>Discard this bill</Button>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!discard} onOpenChange={(o) => !o && setDiscard(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard {discard ? offlineBillNumber(discard.client_ref) : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This bill of {rupees(discard?.expected_total || 0)} will never be saved. Only do this if the sale didn't really happen
              or you have entered it again by hand.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (discard) removeFromQueue(discard.client_ref); setDiscard(null); }}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
