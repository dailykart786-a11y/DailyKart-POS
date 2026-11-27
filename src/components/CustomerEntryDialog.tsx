import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { User, Phone, Mail, MapPin } from "lucide-react";

interface CustomerData {
  name: string;
  phone: string;
  email: string;
  address: string;
}

interface CustomerEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (customerData: CustomerData) => void;
  isLoading?: boolean;
  /** Complete the sale without customer details (walk-in). */
  onSkip?: () => void;
}

export function CustomerEntryDialog({ 
  open, 
  onOpenChange, 
  onSubmit, 
  isLoading = false,
  onSkip
}: CustomerEntryDialogProps) {
  const [customerData, setCustomerData] = useState<CustomerData>({
    name: "",
    phone: "",
    email: "",
    address: ""
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!customerData.name.trim()) {
      return;
    }

    onSubmit(customerData);
  };

  const handleClose = () => {
    setCustomerData({
      name: "",
      phone: "",
      email: "",
      address: ""
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Enter Customer Details
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              Customer Name *
            </Label>
            <Input
              id="name"
              value={customerData.name}
              onChange={(e) => setCustomerData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Enter customer name"
              required
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="phone" className="flex items-center gap-2">
              <Phone className="h-4 w-4" />
              Phone Number
            </Label>
            <Input
              id="phone"
              type="tel"
              value={customerData.phone}
              onChange={(e) => setCustomerData(prev => ({ ...prev, phone: e.target.value }))}
              placeholder="Enter phone number"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="email" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Email Address
            </Label>
            <Input
              id="email"
              type="email"
              value={customerData.email}
              onChange={(e) => setCustomerData(prev => ({ ...prev, email: e.target.value }))}
              placeholder="Enter email address"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="address" className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Address
            </Label>
            <Textarea
              id="address"
              value={customerData.address}
              onChange={(e) => setCustomerData(prev => ({ ...prev, address: e.target.value }))}
              placeholder="Enter customer address"
              rows={3}
            />
          </div>
          
          <div className="flex gap-3 pt-4">
            <Button 
              type="button" 
              variant="outline" 
              onClick={onSkip || handleClose}
              className="flex-1"
              disabled={isLoading}
            >
              {onSkip ? "Walk-in (no details)" : "Skip"}
            </Button>
            <Button 
              type="submit" 
              className="flex-1"
              disabled={isLoading || !customerData.name.trim()}
            >
              {isLoading ? "Processing..." : "Complete Sale"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}