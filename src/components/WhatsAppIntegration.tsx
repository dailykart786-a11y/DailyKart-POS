import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { MessageCircle, Send, FileText, Share, Download, FileUp } from "lucide-react";
import { generateInvoicePDF, downloadPDF } from "@/utils/pdfGenerator";

interface WhatsAppIntegrationProps {
  type: 'invoice' | 'order' | 'custom';
  data?: any;
  recipientPhone?: string;
  recipientName?: string;
  enablePDF?: boolean;
}

export function WhatsAppIntegration({ 
  type, 
  data, 
  recipientPhone = '', 
  recipientName = '',
  enablePDF = true
}: WhatsAppIntegrationProps) {
  const [phone, setPhone] = useState(recipientPhone);
  const [message, setMessage] = useState('');
  const [template, setTemplate] = useState('custom');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [shareMethod, setShareMethod] = useState<'text' | 'pdf'>('text');

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
📱 WhatsApp: +91-9966160298, +91-9381309140
📧 Email: dailykart786@gmail.com

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

  const handlePDFShare = () => {
    if (!data || type !== 'invoice') {
      toast({
        title: "Error",
        description: "Invalid invoice data for PDF generation",
        variant: "destructive"
      });
      return;
    }

    const invoiceData = {
      invoice_number: data.invoice_number || `INV-${Date.now()}`,
      created_at: data.created_at || new Date().toISOString(),
      payment_method: data.payment_method || 'cash',
      customer_name: recipientName || undefined,
      items: data.items?.map((item: any) => {
        const unitPrice = typeof item.unit_price === 'number' ? item.unit_price : parseFloat(item.unit_price) || 0;
        const totalPrice = typeof item.total_price === 'number' ? item.total_price : parseFloat(item.total_price) || 0;
        
        return {
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: unitPrice,
          total_price: totalPrice
        };
      }) || [],
      subtotal: typeof data.subtotal === 'number' ? data.subtotal : parseFloat(data.subtotal?.replace(/,/g, '') || '0'),
      tax_amount: typeof data.tax_amount === 'number' ? data.tax_amount : parseFloat(data.tax_amount?.replace(/,/g, '') || '0'),
      total_amount: typeof data.total_amount === 'number' ? data.total_amount : parseFloat(data.total_amount?.replace(/,/g, '') || '0')
    };

    const pdfDataUri = generateInvoicePDF(invoiceData);
    const filename = `Invoice-${invoiceData.invoice_number}.pdf`;
    
    if (shareMethod === 'pdf') {
      // Download PDF for manual sharing
      downloadPDF(pdfDataUri, filename);
      
      // Also create a WhatsApp message with instruction to attach the PDF
      const instructionMessage = `Hi ${recipientName || 'Customer'}! 

📄 Your invoice from DailyKart is ready!

Invoice: ${invoiceData.invoice_number}
Total Amount: ₹${invoiceData.total_amount.toLocaleString('en-IN')}
Payment: ${invoiceData.payment_method.toUpperCase()}

🔗 I've generated your invoice PDF. Please find it attached.

Thank you for shopping with DailyKart! 🛒`;

      const cleanPhone = phone.replace(/\D/g, '');
      const formattedPhone = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`;
      const whatsappUrl = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(instructionMessage)}`;
      
      window.open(whatsappUrl, '_blank');
      
      toast({
        title: "PDF Downloaded",
        description: "Invoice PDF downloaded. WhatsApp opened - manually attach the PDF file."
      });
    }
    
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

          {enablePDF && type === 'invoice' && (
            <div>
              <Label htmlFor="shareMethod">Share Method</Label>
              <Select value={shareMethod} onValueChange={(value: 'text' | 'pdf') => setShareMethod(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text Message</SelectItem>
                  <SelectItem value="pdf">PDF Document</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

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
            {shareMethod === 'pdf' ? (
              <Button onClick={handlePDFShare} className="flex-1 gap-2">
                <FileUp className="h-4 w-4" />
                Generate PDF & Share
              </Button>
            ) : (
              <Button onClick={sendWhatsAppMessage} className="flex-1 gap-2">
                <Send className="h-4 w-4" />
                Send Message
              </Button>
            )}
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}