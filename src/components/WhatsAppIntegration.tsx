import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { MessageCircle, Send, FileText, Share } from "lucide-react";

interface WhatsAppIntegrationProps {
  type: 'invoice' | 'order' | 'custom';
  data?: any;
  recipientPhone?: string;
  recipientName?: string;
}

export function WhatsAppIntegration({ 
  type, 
  data, 
  recipientPhone = '', 
  recipientName = '' 
}: WhatsAppIntegrationProps) {
  const [phone, setPhone] = useState(recipientPhone);
  const [message, setMessage] = useState('');
  const [template, setTemplate] = useState('custom');
  const [dialogOpen, setDialogOpen] = useState(false);

  const generateMessage = () => {
    switch (type) {
      case 'invoice':
        return generateInvoiceMessage();
      case 'order':
        return generateOrderMessage();
      default:
        return message;
    }
  };

  const generateInvoiceMessage = () => {
    if (!data) return '';
    
    const currentTime = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const invoiceMessage = `
╔══════════════════════════════╗
║        🏪 *DAILYKART POS*        ║
║     Your Neighborhood Store     ║
╚══════════════════════════════╝

📄 *INVOICE RECEIPT*
═══════════════════════════════════

🧾 Invoice No: ${data.invoice_number || 'N/A'}
👤 Customer: ${recipientName || 'Walk-in Customer'}
📅 Date & Time: ${currentTime}
💳 Payment Mode: ${data.payment_method?.toUpperCase() || 'CASH'}

═══════════════════════════════════
📋 *ITEMIZED BILL*
═══════════════════════════════════
${data.items?.map((item: any, index: number) => 
  `${index + 1}. ${item.product_name}
   Qty: ${item.quantity} × ₹${(parseFloat(item.total_price.replace(/,/g, '')) / item.quantity).toFixed(2)}
   Amount: ₹${item.total_price}`
).join('\n\n') || 'No items'}

═══════════════════════════════════
💰 *PAYMENT SUMMARY*
═══════════════════════════════════
   Subtotal      : ₹${data.subtotal || '0.00'}
   GST/Tax       : ₹${data.tax_amount || '0.00'}
   ────────────────────────────
   *TOTAL AMOUNT : ₹${data.total_amount || '0.00'}*

═══════════════════════════════════

🙏 *Thank you for shopping with us!*

💬 Need help? Contact us:
📱 WhatsApp: +91-XXXXXXXXXX
📧 Email: support@dailykart.com

🎁 *Earn loyalty points with every purchase!*
💳 *We accept Cash, Card, UPI payments*

═══════════════════════════════════
⚡ *Powered by DailyKart POS System*
🕐 Generated on: ${currentTime}
    `.trim();

    return invoiceMessage;
  };

  const generateOrderMessage = () => {
    return `
📦 *Order Confirmation - DailyKart*

Hello ${recipientName || 'Customer'}! 

Your order has been confirmed:
${data?.items?.map((item: any) => `• ${item.name} x${item.quantity}`).join('\n') || ''}

Total: ₹${data?.total || 0}

We'll have your order ready for pickup shortly!

Thank you for choosing DailyKart! 🛒
    `.trim();
  };

  const templates = {
    invoice: "Invoice details with itemized list",
    reminder: "Payment reminder message",
    promotion: "Special offer announcement",
    welcome: "Welcome new customer",
    custom: "Custom message"
  };

  const getTemplateMessage = (templateType: string) => {
    switch (templateType) {
      case 'invoice':
        return generateInvoiceMessage();
      case 'reminder':
        return `Hi ${recipientName}! 💰\n\nFriendly reminder about your pending payment of ₹${data?.amount || 0}.\n\nPlease clear at your earliest convenience.\n\nThank you!\n- DailyKart Team`;
      case 'promotion':
        return `🎉 Special Offer at DailyKart! 🎉\n\nHi ${recipientName}!\n\nEnjoy 20% OFF on all grocery items this weekend!\nValid till Sunday.\n\nVisit us now and save big! 💰\n\n- DailyKart Team`;
      case 'welcome':
        return `Welcome to DailyKart! 🎉\n\nHi ${recipientName}!\n\nThank you for choosing us as your trusted grocery partner.\n\nEnjoy exclusive deals and loyalty rewards with every purchase!\n\n- DailyKart Team`;
      default:
        return '';
    }
  };

  const sendWhatsAppMessage = () => {
    if (!phone) {
      toast({
        title: "Error",
        description: "Please enter a phone number",
        variant: "destructive"
      });
      return;
    }

    const finalMessage = template === 'custom' ? message : getTemplateMessage(template);
    
    if (!finalMessage.trim()) {
      toast({
        title: "Error", 
        description: "Please enter a message",
        variant: "destructive"
      });
      return;
    }

    // Clean phone number (remove spaces, dashes, etc.)
    const cleanPhone = phone.replace(/\D/g, '');
    
    // Add country code if not present (assuming India)
    const formattedPhone = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`;
    
    // Create WhatsApp URL
    const whatsappUrl = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(finalMessage)}`;
    
    // Open WhatsApp
    window.open(whatsappUrl, '_blank');
    
    toast({
      title: "Success",
      description: "WhatsApp opened with your message!"
    });

    setDialogOpen(false);
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <MessageCircle className="h-4 w-4" />
          Share via WhatsApp
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-green-600" />
            Send via WhatsApp
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div>
            <Label htmlFor="phone">Phone Number (with country code)</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 9876543210"
              type="tel"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Enter phone number with country code (e.g., +91 for India)
            </p>
          </div>

          <div>
            <Label htmlFor="template">Message Template</Label>
            <Select value={template} onValueChange={setTemplate}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(templates).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {template === 'custom' && (
            <div>
              <Label htmlFor="message">Custom Message</Label>
              <Textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type your custom message here..."
                rows={4}
              />
            </div>
          )}

          {template !== 'custom' && (
            <div>
              <Label>Message Preview</Label>
              <div className="p-3 bg-muted rounded-md text-sm whitespace-pre-wrap max-h-32 overflow-y-auto">
                {getTemplateMessage(template)}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={sendWhatsAppMessage} className="flex-1 gap-2">
              <Send className="h-4 w-4" />
              Send Message
            </Button>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}