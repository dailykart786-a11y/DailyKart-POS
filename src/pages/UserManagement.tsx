import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { Plus, Users, Shield, Eye, EyeOff, Copy, Mail, Edit, Trash2 } from "lucide-react";
import { UserEditDialog } from "@/components/UserEditDialog";
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

interface InvitedUser {
  id: string;
  email: string;
  role: string;
  invited_at: string;
  used_at: string | null;
  invitation_token: string;
  expires_at: string;
}

export default function UserManagement() {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [invitedUsers, setInvitedUsers] = useState<InvitedUser[]>([]);
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

      // Fetch active invitations
      const { data: invitedData, error: invitedError } = await supabase
        .from('invited_users')
        .select('*')
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('invited_at', { ascending: false });
      
      if (invitedError) throw invitedError;

      setProfiles(profileData || []);
      setUserRoles(roleData || []);
      setInvitedUsers(invitedData || []);
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

  const handleInviteUser = async () => {
    if (!newUserEmail || !newUserName) {
      toast({
        title: "Error",
        description: "Please fill in email and name",
        variant: "destructive"
      });
      return;
    }

    try {
      // Create invitation record with secure token
      const { data: inviteData, error: inviteError } = await supabase
        .from('invited_users')
        .insert({
          email: newUserEmail,
          role: newUserRole,
          invited_by: user?.id
        })
        .select('invitation_token')
        .single();

      if (inviteError) throw inviteError;

      // Generate secure invitation link
      const inviteLink = `${window.location.origin}/auth?invite=${inviteData.invitation_token}`;
      setGeneratedPassword(inviteLink);

      toast({
        title: "User Invited",
        description: `${newUserEmail} has been invited. Share the invitation link with them.`
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
        description: error.message || "Failed to invite user",
        variant: "destructive"
      });
    }
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(generatedPassword);
    toast({
      title: "Copied",
      description: "Invitation link copied to clipboard"
    });
  };

  const getUserRole = (userId: string) => {
    return userRoles.find(role => role.user_id === userId)?.role || "cashier";
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-red-100 text-red-800';
      case 'manager': return 'bg-blue-100 text-blue-800';
      case 'cashier': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const handleEditUser = (profile: Profile) => {
    setEditingUser(profile);
    setEditingUserRole(getUserRole(profile.user_id));
  };

  const handleDeleteUser = async (profile: Profile) => {
    if (!window.confirm(`Are you sure you want to delete ${profile.full_name || 'this user'}?`)) return;
    
    try {
      // Delete user role first
      const { error: roleError } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', profile.user_id);

      if (roleError) throw roleError;

      // Delete profile
      const { error: profileError } = await supabase
        .from('profiles')
        .delete()
        .eq('id', profile.id);

      if (profileError) throw profileError;

      toast({
        title: "Success",
        description: "User deleted successfully"
      });

      fetchData();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete user",
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
                <DialogTitle>Invite New User</DialogTitle>
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
                  <Label htmlFor="role">Role</Label>
                  <Select value={newUserRole} onValueChange={setNewUserRole}>
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
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">
                    A secure invitation link will be generated for this user
                  </Label>
                </div>
                <Button onClick={handleInviteUser} className="w-full">
                  <Mail className="h-4 w-4 mr-2" />
                  Send Invitation
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

        {/* Secure Invitation Link Display */}
        {generatedPassword && (
          <Card className="bg-blue-50 border-blue-200">
            <CardHeader>
              <CardTitle className="text-blue-800">Secure Invitation Link Generated</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Input
                  value={generatedPassword}
                  type={showPassword ? "text" : "password"}
                  readOnly
                  className="font-mono"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button variant="outline" size="icon" onClick={copyInviteLink}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm text-blue-700 mt-2">
                Share this secure invitation link with the user. They can use it to complete their registration.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Invited Users Table */}
        {invitedUsers.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Pending Invitations</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Invited At</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitedUsers.map((invite) => (
                    <TableRow key={invite.id}>
                      <TableCell>{invite.email}</TableCell>
                      <TableCell>
                        <Badge className={getRoleBadgeColor(invite.role)}>
                          {invite.role.charAt(0).toUpperCase() + invite.role.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(invite.invited_at).toLocaleDateString('en-IN')}
                      </TableCell>
                      <TableCell>
                        <Badge variant={invite.used_at ? "default" : "secondary"}>
                          {invite.used_at ? "Accepted" : "Pending"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

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
                          {getUserRole(profile.user_id).charAt(0).toUpperCase() + getUserRole(profile.user_id).slice(1)}
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