import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { markManualSignOut } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { LogOut, ShieldCheck } from "lucide-react";

interface Factor { id: string; status: string; friendly_name?: string | null; }

/** Two-step login (authenticator app) and "sign out everywhere", from the user menu. */
export function LoginSecurity() {
  const [open, setOpen] = useState(false);
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      setFactors(((data?.totp || []) as any[]).map((f) => ({ id: f.id, status: f.status, friendly_name: f.friendly_name })));
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    }
  };

  const start = async () => {
    setBusy(true);
    try {
      // clear a half-finished setup first
      const { data: all } = await supabase.auth.mfa.listFactors();
      for (const f of ((all as any)?.all || []) as any[]) {
        if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `DailyKart ${new Date().toLocaleDateString("en-IN")}` });
      if (error) throw error;
      setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
      setCode("");
    } catch (e: any) {
      toast({ title: "Couldn't start", description: /disabled|not enabled/i.test(e?.message || "") ? "Turn on TOTP in Supabase → Authentication → Multi-factor" : e?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!enroll) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.id, code: code.trim() });
    setBusy(false);
    if (error) { toast({ title: "Code didn't work", description: "Type the newest code from the app", variant: "destructive" }); return; }
    toast({ title: "Two-step login is on", description: "You'll be asked for a code each time you sign in" });
    setEnroll(null);
    load();
  };

  const turnOff = async (f: Factor) => {
    setBusy(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    setBusy(false);
    if (error) { toast({ title: "Not turned off", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Two-step login is off" });
    load();
  };

  const signOutEverywhere = async () => {
    setBusy(true);
    markManualSignOut();
    const { error } = await supabase.auth.signOut({ scope: "global" });
    setBusy(false);
    if (error) toast({ title: "Not signed out", description: error.message, variant: "destructive" });
  };

  const active = (factors || []).filter((f) => f.status === "verified");
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); else setEnroll(null); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" className="w-full justify-start gap-2"><ShieldCheck className="h-4 w-4" /> Login security</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Login security</DialogTitle></DialogHeader>
        <div className="space-y-5">
          <section className="space-y-2">
            <h3 className="font-medium">Two-step login</h3>
            <p className="text-sm text-muted-foreground">After your password, also type a code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy). A stolen password alone then can't open your account.</p>
            {unavailable ? <p className="text-sm text-muted-foreground">Not available right now (no internet, or not turned on for this project).</p>
              : factors === null ? <p className="text-sm text-muted-foreground">Checking…</p>
              : enroll ? (
                <div className="space-y-2">
                  <p className="text-sm">1. Scan this with the app:</p>
                  <img src={enroll.qr} alt="QR code for the authenticator app" className="h-44 w-44 rounded border bg-white p-2" />
                  <p className="text-xs text-muted-foreground break-all">Or type this key: {enroll.secret}</p>
                  <Label htmlFor="enroll-code">2. Type the 6-digit code it shows</Label>
                  <div className="flex gap-2">
                    <Input id="enroll-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
                    <Button onClick={confirm} disabled={busy || code.length !== 6}>Turn on</Button>
                  </div>
                </div>
              ) : active.length ? (
                <div className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
                  <span>On · {active[0].friendly_name || "Authenticator app"}</span>
                  <Button size="sm" variant="outline" onClick={() => turnOff(active[0])} disabled={busy}>Turn off</Button>
                </div>
              ) : <Button onClick={start} disabled={busy}>Set up two-step login</Button>}
          </section>
          <section className="space-y-2 border-t pt-4">
            <h3 className="font-medium">Sign out on all devices</h3>
            <p className="text-sm text-muted-foreground">Use this if a phone or computer was lost, or someone else knows your password. Change the password afterwards.</p>
            <Button variant="outline" className="gap-2" onClick={signOutEverywhere} disabled={busy}><LogOut className="h-4 w-4" /> Sign out everywhere</Button>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
