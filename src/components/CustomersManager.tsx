import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INDIAN_STATES, isValidGstin } from "@/lib/invoice";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { Plus, Edit, Users, Mail, Phone, Star, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  loyalty_points: number | null;
  created_at: string | null;
  gstin?: string | null;
  state_code?: string | null;
}

export function CustomersManager() {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  
  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [gstin, setGstin] = useState("");
  const [stateCode, setStateCode] = useState("");

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCustomers(data || []);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch customers",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setName("");
    setEmail("");
    setPhone("");
    setAddress("");
    setGstin("");
    setStateCode("");
    setEditingCustomer(null);
    setShowForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      const customerData: Record<string, any> = {
        name,
        email: email || null,
        phone: phone || null,
        address: address || null,
        loyalty_points: null
      };
      const cleanGstin = gstin.trim().toUpperCase();
      if (cleanGstin && !isValidGstin(cleanGstin)) {
        toast({ title: "Check GSTIN", description: "GSTIN should be 15 characters, like 36ABCDE1234F1Z5", variant: "destructive" });
        return;
      }
      // Only send GST fields when used, so saving works before the GST database update
      if (cleanGstin || stateCode || editingCustomer?.gstin || editingCustomer?.state_code) {
        customerData.gstin = cleanGstin || null;
        customerData.state_code = stateCode || (cleanGstin ? cleanGstin.slice(0, 2) : null);
      }

      const save = (data: Record<string, any>) => editingCustomer
        ? supabase.from('customers').update(data as any).eq('id', editingCustomer.id)
        : supabase.from('customers').insert(data as any);

      let { error } = await save(customerData);
      if (error && 'gstin' in customerData && /gstin|state_code/.test(error.message || '')) {
        const { gstin: _g, state_code: _s, ...rest } = customerData;
        ({ error } = await save(rest));
        if (!error) toast({ title: "GSTIN not saved", description: "Ask your admin to run the GST database update to store GSTIN" });
      }
      if (error) throw error;
      toast({ title: "Success", description: editingCustomer ? "Customer updated successfully" : "Customer added successfully" });

      resetForm();
      fetchCustomers();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save customer",
        variant: "destructive"
      });
    }
  };

  const handleEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setName(customer.name);
    setEmail(customer.email || "");
    setPhone(customer.phone || "");
    setAddress(customer.address || "");
    setGstin(customer.gstin || "");
    setStateCode(customer.state_code || "");
    setShowForm(true);
  };

  const handleDelete = async (customerId: string) => {
    if (!window.confirm("Are you sure you want to delete this customer?")) return;
    
    try {
      const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', customerId);

      if (error) throw error;
      
      toast({
        title: "Success",
        description: "Customer deleted successfully"
      });
      
      fetchCustomers();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete customer",
        variant: "destructive"
      });
    }
  };

  const getTierBadge = (points: number | null) => {
    if (!points) return <Badge variant="outline">New</Badge>;
    if (points >= 1000) return <Badge className="bg-purple-100 text-purple-800">Platinum</Badge>;
    if (points >= 500) return <Badge className="bg-yellow-100 text-yellow-800">Gold</Badge>;
    if (points >= 200) return <Badge className="bg-gray-100 text-gray-800">Silver</Badge>;
    return <Badge className="bg-amber-100 text-amber-800">Bronze</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Customer Management</h2>
          <p className="text-muted-foreground">Manage your customer database and loyalty programs</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="gap-2">
          <Plus className="h-4 w-4" />
          {editingCustomer ? "Cancel Edit" : "Add Customer"}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Customers</p>
                <p className="text-2xl font-bold">{customers.length}</p>
              </div>
              <Users className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">New This Month</p>
                <p className="text-2xl font-bold">
                  {customers.filter(c => 
                    c.created_at && new Date(c.created_at).getMonth() === new Date().getMonth()
                  ).length}
                </p>
              </div>
              <Plus className="h-8 w-8 text-success" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">With Email</p>
                <p className="text-2xl font-bold">{customers.filter(c => c.email).length}</p>
              </div>
              <Mail className="h-8 w-8 text-accent" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">With Phone</p>
                <p className="text-2xl font-bold">{customers.filter(c => c.phone).length}</p>
              </div>
              <Phone className="h-8 w-8 text-warning" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Add/Edit Customer Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingCustomer ? "Edit Customer" : "Add New Customer"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name *</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter customer name"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98765-43210"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="customer@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Textarea
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Enter customer address"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="gstin">GSTIN (business customers)</Label>
                  <Input
                    id="gstin"
                    value={gstin}
                    onChange={(e) => {
                      const v = e.target.value.toUpperCase().slice(0, 15);
                      setGstin(v);
                      if (/^[0-9]{2}/.test(v) && INDIAN_STATES.some(st => st.code === v.slice(0, 2))) setStateCode(v.slice(0, 2));
                    }}
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-2">
                  <Label>State</Label>
                  <Select value={stateCode} onValueChange={setStateCode}>
                    <SelectTrigger><SelectValue placeholder="Same as shop" /></SelectTrigger>
                    <SelectContent>
                      {INDIAN_STATES.map(st => (
                        <SelectItem key={st.code} value={st.code}>{st.code} - {st.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Other state means IGST on the bill</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit">
                  {editingCustomer ? "Update Customer" : "Add Customer"}
                </Button>
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Customers Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Customer Database ({customers.length} customers)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-4">Loading customers...</div>
          ) : customers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No customers found. Add your first customer to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{customer.name}</p>
                        <p className="text-sm text-muted-foreground">ID: {customer.id.slice(0, 8)}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {customer.email && (
                          <div className="flex items-center gap-2 text-sm">
                            <Mail className="h-3 w-3" />
                            {customer.email}
                          </div>
                        )}
                        {customer.phone && (
                          <div className="flex items-center gap-2 text-sm">
                            <Phone className="h-3 w-3" />
                            {customer.phone}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{customer.address || "N/A"}</p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {customer.created_at 
                        ? new Date(customer.created_at).toLocaleDateString('en-IN')
                        : "N/A"
                      }
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          size="icon" 
                          className="h-8 w-8"
                          onClick={() => handleEdit(customer)}
                        >
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button 
                          variant="destructive" 
                          size="icon" 
                          className="h-8 w-8"
                          onClick={() => handleDelete(customer.id)}
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
    </div>
  );
}