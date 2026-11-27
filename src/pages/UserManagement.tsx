import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLE_OPTIONS, roleBadgeClass, roleLabel } from "@/lib/roles";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { Plus, Users, Shield, Eye, EyeOff, Edit, Trash2 } from "lucide-react";
import { UserEditDialog } from "@/components/UserEditDialog";
import { StoresManager } from "@/components/StoresManager";
import { RolePermissionsCard } from "@/components/RolePermissionsCard";
import { callAdminUsers } from "@/lib/adminUsers";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Profile {
  id: string;
  user_id: string;
  full_name: string | null;
  role: string | null;
  created_at: string | null;
}

interface UserRole {
  user_id: string;
  role: string;
}


export default function UserManagement() {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  
  const [currentUserRole, setCurrentUserRole] = useState<string>("cashier");
  const [loading, setLoading] = useState(true);
  const [showAddUser, setShowAddUser] = useState(false);
  
  // Form state
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserRole, setNewUserRole] = useState("cashier");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [editingUserRole, setEditingUserRole] = useState("");

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    try {
      // Fetch current user role
      const { data: currentRole } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user?.id)
        .single();

      setCurrentUserRole(currentRole?.role || "cashier");

      // Only admins can see user management
      if (currentRole?.role !== 'admin') {
        return;
      }

      // Fetch all profiles
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (profileError) throw profileError;

      // Fetch all user roles
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('*');

      if (roleError) throw roleError;

      setProfiles(profileData || []);
      setUserRoles(roleData || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({
        title: "Error",
        description: "Failed to fetch user data",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const generatePassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  };

  const handleCreateUser = async () => {
    if (!newUserEmail || !newUserName || !newUserPassword) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

    try {
      // The sign-in service knows admin / manager / cashier; newer roles are set right after
      const basicRole = ["admin", "manager", "cashier"].includes(newUserRole) ? newUserRole : "cashier";
      const created: any = await callAdminUsers({
        action: "create",
        email: newUserEmail,
        password: newUserPassword,
        fullName: newUserName,
        role: basicRole,
      });
      if (basicRole !== newUserRole && created?.userId) {
        const { error: roleErr } = await supabase.from('user_roles').update({ role: newUserRole } as any).eq('user_id', created.userId);
        if (roleErr) toast({ title: "User created as cashier", description: `Couldn't set ${roleLabel(newUserRole)}: ${roleErr.message}. Edit the user to change it.`, variant: "destructive" });
      }

      toast({
        title: "User Created",
        description: `${newUserEmail} has been created successfully.`
      });

      // Reset form
      setNewUserEmail("");
      setNewUserName("");
      setNewUserRole("cashier");
      setNewUserPassword("");
      setShowAddUser(false);
      fetchData();

    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create user",
        variant: "destructive"
      });
    }
  };


  const getUserRole = (userId: string) => {
    return userRoles.find(role => role.user_id === userId)?.role || "cashier";
  };

  const getRoleBadgeColor = (role: string) => {
    return roleBadgeClass(role);
  };

  const handleEditUser = (profile: Profile) => {
    setEditingUser(profile);
    setEditingUserRole(getUserRole(profile.user_id));
  };

  const handleDeleteUser = async (profile: Profile) => {
    if (!window.confirm(`Are you sure you want to delete ${profile.full_name || 'this user'}?`)) return;
    
    try {
      const res = await callAdminUsers({ action: "delete", userId: profile.user_id });

      toast({
        title: "Success",
        description: res.result === "deactivated"
          ? "This user has past records, so their login was blocked instead of deleted."
          : "User removed successfully"
      });

      fetchData();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete user",
        variant: "destructive"
      });
    }
  };

  // Only admins can access this page
  if (currentUserRole !== 'admin') {
    return (
      <Layout>
        <div className="text-center py-8">
          <Shield className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Access Restricted</h2>
          <p className="text-muted-foreground">
            Only administrators can access user management.
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">User Management</h2>
            <p className="text-muted-foreground">Manage system users and their permissions</p>
          </div>
          <Dialog open={showAddUser} onOpenChange={setShowAddUser}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Add User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New User</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address *</Label>
                  <Input
                    id="email"
                    type="email"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    placeholder="user@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name *</Label>
                  <Input
                    id="name"
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    placeholder="John Doe"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password *</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={newUserPassword}
                      onChange={(e) => setNewUserPassword(e.target.value)}
                      placeholder="Enter secure password"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <Button 
                    type="button"
                    variant="outline" 
                    size="sm"
                    onClick={() => setNewUserPassword(generatePassword())}
                  >
                    Generate Password
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <Select value={newUserRole} onValueChange={setNewUserRole}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleCreateUser} className="w-full">
                  <Plus className="h-4 w-4 mr-2" />
                  Create User
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Users</p>
                  <p className="text-2xl font-bold">{profiles.length}</p>
                </div>
                <Users className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Admins</p>
                  <p className="text-2xl font-bold">
                    {userRoles.filter(r => r.role === 'admin').length}
                  </p>
                </div>
                <Shield className="h-8 w-8 text-red-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Managers</p>
                  <p className="text-2xl font-bold">
                    {userRoles.filter(r => r.role === 'manager').length}
                  </p>
                </div>
                <Users className="h-8 w-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Cashiers</p>
                  <p className="text-2xl font-bold">
                    {userRoles.filter(r => r.role === 'cashier').length}
                  </p>
                </div>
                <Users className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>
        </div>


        {/* System Users Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              System Users ({profiles.length} users)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-4">Loading users...</div>
            ) : profiles.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No users found.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>User ID</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.map((profile) => (
                    <TableRow key={profile.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{profile.full_name || "No Name"}</p>
                          <p className="text-sm text-muted-foreground">ID: {profile.id.slice(0, 8)}</p>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {profile.user_id.slice(0, 8)}...
                      </TableCell>
                      <TableCell>
                        <Badge className={getRoleBadgeColor(getUserRole(profile.user_id))}>
                          {roleLabel(getUserRole(profile.user_id))}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {profile.created_at 
                          ? new Date(profile.created_at).toLocaleDateString('en-IN')
                          : "N/A"
                        }
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button 
                            variant="outline" 
                            size="icon" 
                            className="h-8 w-8"
                            onClick={() => handleEditUser(profile)}
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button 
                            variant="destructive" 
                            size="icon" 
                            className="h-8 w-8"
                            onClick={() => handleDeleteUser(profile)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Stores */}
        <StoresManager />

        <RolePermissionsCard />

        {/* Role Permissions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Role Permissions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="text-left p-2">Permission</th>
                    <th className="text-center p-2">Cashier</th>
                    <th className="text-center p-2">Manager</th>
                    <th className="text-center p-2">Admin</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="p-2">Process Sales</td>
                    <td className="text-center p-2">✅</td>
                    <td className="text-center p-2">✅</td>
                    <td className="text-center p-2">✅</td>
                  </tr>
                  <tr>
                    <td className="p-2">Manage Products</td>
                    <td className="text-center p-2">❌</td>
                    <td className="text-center p-2">✅</td>
                    <td className="text-center p-2">✅</td>
                  </tr>
                  <tr>
                    <td className="p-2">View Reports</td>
                    <td className="text-center p-2">❌</td>
                    <td className="text-center p-2">✅</td>
                    <td className="text-center p-2">✅</td>
                  </tr>
                  <tr>
                    <td className="p-2">Manage Users</td>
                    <td className="text-center p-2">❌</td>
                    <td className="text-center p-2">❌</td>
                    <td className="text-center p-2">✅</td>
                  </tr>
                  <tr>
                    <td className="p-2">System Settings</td>
                    <td className="text-center p-2">❌</td>
                    <td className="text-center p-2">❌</td>
                    <td className="text-center p-2">✅</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* User Edit Dialog */}
        <UserEditDialog
          user={editingUser}
          userRole={editingUserRole}
          onClose={() => setEditingUser(null)}
          onSave={fetchData}
        />
      </div>
    </Layout>
  );
}