import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { callAdminUsers } from "@/lib/adminUsers";
import { useStore } from "@/hooks/useStore";

interface Profile {
  id: string;
  user_id: string;
  full_name: string | null;
  role: string | null;
  created_at: string | null;
}

interface UserEditDialogProps {
  user: Profile | null;
  userRole: string;
  onClose: () => void;
  onSave: () => void;
}

export function UserEditDialog({ user, userRole, onClose, onSave }: UserEditDialogProps) {
  const [fullName, setFullName] = useState(user?.full_name || "");
  const [role, setRole] = useState(userRole || "cashier");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { stores } = useStore();
  const [storeId, setStoreId] = useState<string>("");
  const [originalStoreId, setOriginalStoreId] = useState<string>("");

  // Reset form when user changes
  useEffect(() => {
    if (user) {
      setFullName(user.full_name || "");
      setRole(userRole || "cashier");
      setEmail("");
      setNewPassword("");
      setStoreId("");
      setOriginalStoreId("");
      supabase
        .from('user_location_assignments')
        .select('location_id')
        .eq('user_id', user.user_id)
        .maybeSingle()
        .then(({ data }) => {
          setStoreId(data?.location_id || "");
          setOriginalStoreId(data?.location_id || "");
        });
    }
  }, [user, userRole]);

  const handleSave = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      // Update profile
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ full_name: fullName })
        .eq('id', user.id);

      if (profileError) throw profileError;

      // Update role (insert if missing)
      const { data: existingRole, error: existingRoleError } = await supabase
        .from('user_roles')
        .select('id')
        .eq('user_id', user.user_id)
        .maybeSingle();

      if (existingRoleError) throw existingRoleError;

      if (existingRole) {
        const { error: roleError } = await supabase
          .from('user_roles')
          .update({ role })
          .eq('user_id', user.user_id);
        if (roleError) throw roleError;
      } else {
        const { error: roleInsertError } = await supabase
          .from('user_roles')
          .insert({ user_id: user.user_id, role });
        if (roleInsertError) throw roleInsertError;
      }

      // Move the user to another store
      if (storeId && storeId !== originalStoreId) {
        const { error: storeError } = await supabase
          .from('user_location_assignments')
          .upsert({ user_id: user.user_id, location_id: storeId }, { onConflict: 'user_id' });
        if (storeError) throw storeError;
      }

      // Update email / password through the admin-users function
      if (email.trim() || newPassword.trim()) {
        await callAdminUsers({
          action: "update",
          userId: user.user_id,
          email: email.trim() || undefined,
          password: newPassword.trim() || undefined,
        });
      }

      toast({
        title: "Success",
        description: "User updated successfully"
      });

      onSave();
      onClose();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update user",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Enter full name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">New Email (Optional)</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter new email address"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">New Password (Optional)</Label>
            <Input
              id="password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cashier">Cashier</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {stores.length > 1 && (
            <div className="space-y-2">
              <Label>Store</Label>
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select store" />
                </SelectTrigger>
                <SelectContent>
                  {stores.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Cashiers and managers only see this store's products, bills and customers.</p>
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={loading}>
              {loading ? "Saving..." : "Save Changes"}
            </Button>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}