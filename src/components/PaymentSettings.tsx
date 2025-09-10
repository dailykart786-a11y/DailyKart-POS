import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "@/hooks/use-toast";
import { Save, CreditCard, Lock } from "lucide-react";

interface PaymentSetting {
  id: string;
  upi_vpa: string;
  payee_name: string | null;
  location_id: string;
  updated_at: string;
}

export function PaymentSettings() {
  const { user } = useAuth();
  const { role } = useUserRole();
  const [settings, setSettings] = useState<PaymentSetting | null>(null);
  const [upiVpa, setUpiVpa] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchPaymentSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('payment_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setSettings(data);
        setUpiVpa(data.upi_vpa);
        setPayeeName(data.payee_name || "");
      }
    } catch (error) {
      console.error('Error fetching payment settings:', error);
      toast({
        title: "Error",
        description: "Failed to fetch payment settings",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (role === 'admin') {
      fetchPaymentSettings();
    } else {
      setLoading(false);
    }
  }, [role]);

  const saveSettings = async () => {
    if (!user) return;
    
    if (!upiVpa.trim()) {
      toast({
        title: "Error",
        description: "UPI VPA is required",
        variant: "destructive"
      });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        upi_vpa: upiVpa.trim(),
        payee_name: payeeName.trim() || null,
        updated_by: user.id,
        updated_at: new Date().toISOString()
      };

      let result;
      if (settings) {
        // Update existing settings
        result = await supabase
          .from('payment_settings')
          .update(payload)
          .eq('id', settings.id)
          .select()
          .single();
      } else {
        // Insert new settings
        result = await supabase
          .from('payment_settings')
          .insert(payload)
          .select()
          .single();
      }

      if (result.error) throw result.error;

      setSettings(result.data);
      toast({
        title: "Success",
        description: "Payment settings saved successfully"
      });
    } catch (error) {
      console.error('Error saving payment settings:', error);
      toast({
        title: "Error",
        description: "Failed to save payment settings",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  // Only allow admin access
  if (role !== 'admin') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Lock className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">Access Restricted</h3>
          <p className="text-muted-foreground text-center">
            Only administrators can access payment settings.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return <div className="text-center py-4">Loading payment settings...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Payment Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="upi_vpa">UPI VPA (Virtual Payment Address) *</Label>
          <Input
            id="upi_vpa"
            value={upiVpa}
            onChange={(e) => setUpiVpa(e.target.value)}
            placeholder="e.g., 6302242108@kotak811"
            type="text"
          />
          <p className="text-xs text-muted-foreground">
            This UPI ID will be used for generating QR codes for customer payments
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="payee_name">Payee Name (Optional)</Label>
          <Input
            id="payee_name"
            value={payeeName}
            onChange={(e) => setPayeeName(e.target.value)}
            placeholder="e.g., DailyKart Store"
            type="text"
          />
          <p className="text-xs text-muted-foreground">
            Name that will appear on the UPI payment request
          </p>
        </div>

        <Button onClick={saveSettings} disabled={saving} className="gap-2">
          <Save className="h-4 w-4" />
          {saving ? "Saving..." : "Save Settings"}
        </Button>

        {settings && (
          <p className="text-xs text-muted-foreground">
            Last updated: {new Date(settings.updated_at).toLocaleString('en-IN')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}