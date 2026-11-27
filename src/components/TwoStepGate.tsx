import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { markManualSignOut } from "@/hooks/useAuth";
import { ShieldCheck } from "lucide-react";
import { FullPageLoader } from "@/components/feedback/FullPageLoader";

/**
 * Asks for the authenticator code when the person has two-step login on and
 * this session hasn't passed it yet. Anything unexpected lets the app open as before.
 */
export function TwoStepGate({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [needed, setNeeded] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (!live) return;
        setNeeded(!error && !!data && data.nextLevel === "aal2" && data.currentLevel !== "aal2");
      } catch {
        if (live) setNeeded(false);
      }
    })();
    return () => { live = false; };
  }, [userId]);

  if (needed === null) {
    return <FullPageLoader />;
  }
  if (!needed) return <>{children}</>;

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { data: f, error: fe } = await supabase.auth.mfa.listFactors();
      if (fe) throw fe;
      const factor = f?.totp?.find((x) => x.status === "verified") || f?.totp?.[0];
      if (!factor) { setNeeded(false); return; }
      const { error: ve } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
      if (ve) throw ve;
      setNeeded(false);
    } catch (err: any) {
      setError(/invalid|code/i.test(err?.message || "") ? "That code didn't work. Check the time on your phone and try the newest code." : (err?.message || "Couldn't check the code"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Two-step login</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={verify} className="space-y-3">
            <p className="text-sm text-muted-foreground">Open your authenticator app and type the 6-digit code for DailyKart.</p>
            <div className="space-y-1">
              <Label htmlFor="mfa-code">Code</Label>
              <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>Continue</Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => { markManualSignOut(); supabase.auth.signOut(); }}>Sign out</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
