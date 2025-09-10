import jsPDF from 'jspdf';

interface InvoiceData {
  invoice_number: string;
  created_at: string;
  payment_method: string;
  customer_name?: string;
  items: Array<{
    product_name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
  }>;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
}

export const generateInvoicePDF = (invoiceData: InvoiceData): string => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [80, 200] // 80mm width thermal receipt
  });

  const pageWidth = 80;
  let yPosition = 10;

  // Helper function to add centered text
  const addCenteredText = (text: string, fontSize: number = 10, isBold: boolean = false) => {
    doc.setFontSize(fontSize);
    if (isBold) doc.setFont('helvetica', 'bold');
    else doc.setFont('helvetica', 'normal');
    
    const textWidth = doc.getTextWidth(text);
    const x = (pageWidth - textWidth) / 2;
    doc.text(text, x, yPosition);
    yPosition += fontSize * 0.5 + 2;
  };

  // Helper function to add left-aligned text
  const addLeftText = (text: string, fontSize: number = 8) => {
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', 'normal');
    doc.text(text, 5, yPosition);
    yPosition += fontSize * 0.5 + 2;
  };

  // Helper function to add justified text (left and right)
  const addJustifiedText = (leftText: string, rightText: string, fontSize: number = 8) => {
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', 'normal');
    doc.text(leftText, 5, yPosition);
    
    const rightTextWidth = doc.getTextWidth(rightText);
    doc.text(rightText, pageWidth - rightTextWidth - 5, yPosition);
    yPosition += fontSize * 0.5 + 2;
  };

  // Add dashed line
  const addDashedLine = () => {
    const lineY = yPosition;
    for (let x = 5; x < pageWidth - 5; x += 3) {
      doc.line(x, lineY, x + 1, lineY);
    }
    yPosition += 4;
  };

  // Store Header with Logo
  addCenteredText('🏪 DAILYKART POS 🏪', 14, true);
  addCenteredText('Your Daily Shopping Partner', 8);
  addCenteredText('📞 +91-9966160298, +91-9381309140', 7);
  addCenteredText('📧 dailykart786@gmail.com', 7);
  
  addDashedLine();
  
  // Invoice Details
  addCenteredText('TAX INVOICE', 12, true);
  addLeftText(`Invoice: ${invoiceData.invoice_number}`, 8);
  
  const invoiceDate = new Date(invoiceData.created_at);
  addLeftText(`Date: ${invoiceDate.toLocaleDateString('en-IN')}`, 8);
  addLeftText(`Time: ${invoiceDate.toLocaleTimeString('en-IN')}`, 8);
  
  if (invoiceData.customer_name) {
    addLeftText(`Customer: ${invoiceData.customer_name}`, 8);
  }
  
  addDashedLine();
  
  // Items Header
  addJustifiedText('ITEM', 'QTY × RATE = AMT', 8);
  addDashedLine();
  
  // Items
  invoiceData.items.forEach(item => {
    // Product name
    addLeftText(item.product_name, 8);
    
    // Quantity and amount - ensure proper formatting
    const unitPrice = Number(item.unit_price);
    const totalPrice = Number(item.total_price);
    const qtyText = `${item.quantity} × ₹${unitPrice.toLocaleString('en-IN')}`;
    const amtText = `₹${totalPrice.toLocaleString('en-IN')}`;
    addJustifiedText(qtyText, amtText, 8);
    yPosition += 1; // Extra spacing between items
  });
  
  addDashedLine();
  
  // Totals
  addJustifiedText('Subtotal:', `₹${invoiceData.subtotal.toLocaleString('en-IN')}`, 8);
  addJustifiedText('GST:', `₹${invoiceData.tax_amount.toLocaleString('en-IN')}`, 8);
  addDashedLine();
  addJustifiedText('TOTAL:', `₹${invoiceData.total_amount.toLocaleString('en-IN')}`, 10);
  
  addCenteredText(`Payment: ${invoiceData.payment_method.toUpperCase()}`, 9, true);
  
  addDashedLine();
  
  // Footer
  addCenteredText('🙏 THANK YOU FOR SHOPPING! 🙏', 9, true);
  addCenteredText('Visit us again for more great deals', 7);
  addCenteredText('💳 We accept Cash, Card, UPI payments', 7);
  yPosition += 3;
  addCenteredText('📞 Customer Care: +91-9966160298', 6);
  addCenteredText('⭐ Rate us on Google for better service', 6);

  return doc.output('datauristring');
};

export const downloadPDF = (pdfDataUri: string, filename: string) => {
  const link = document.createElement('a');
  link.href = pdfDataUri;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const printPDF = (pdfDataUri: string) => {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = pdfDataUri;
  document.body.appendChild(iframe);
  
  iframe.onload = () => {
    iframe.contentWindow?.print();
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1000);
  };
};