import jsPDF from 'jspdf';
import { stateName, type Invoice } from '@/lib/invoice';

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
  addCenteredText('DAILYKART POS', 14, true);
  addCenteredText('Your Daily Shopping Partner', 8);
  addCenteredText('Ph: +91-9966160298, +91-9381309140', 7);
  addCenteredText('Email: dailykart786@gmail.com', 7);
  
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
    const qtyText = `${item.quantity} x Rs.${unitPrice.toFixed(2)}`;
    const amtText = `Rs.${totalPrice.toFixed(2)}`;
    addJustifiedText(qtyText, amtText, 8);
    yPosition += 1; // Extra spacing between items
  });
  
  addDashedLine();
  
  // Totals
  addJustifiedText('Subtotal:', `Rs.${invoiceData.subtotal.toFixed(2)}`, 8);
  addJustifiedText('GST:', `Rs.${invoiceData.tax_amount.toFixed(2)}`, 8);
  addDashedLine();
  addJustifiedText('TOTAL:', `Rs.${invoiceData.total_amount.toFixed(2)}`, 10);
  
  addCenteredText(`Payment: ${invoiceData.payment_method.toUpperCase()}`, 9, true);
  
  addDashedLine();
  
  // Footer
  addCenteredText('THANK YOU FOR SHOPPING!', 9, true);
  addCenteredText('Visit us again for more great deals', 7);
  addCenteredText('We accept Cash, Card, UPI payments', 7);
  yPosition += 3;
  addCenteredText('Customer Care: +91-9966160298', 6);
  addCenteredText('Rate us on Google for better service', 6);

  return doc.output('datauristring');
};

// GST bill with shop details, HSN and CGST/SGST (or IGST) split
export const generateGstInvoicePDF = (inv: Invoice): string => {
  const height = 120 + inv.lines.length * 9 + inv.taxRows.length * 5;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [80, Math.max(160, height)] });
  const W = 80;
  let y = 8;
  const font = (size: number, bold = false) => { doc.setFontSize(size); doc.setFont('helvetica', bold ? 'bold' : 'normal'); };
  const center = (t: string, size = 8, bold = false) => {
    font(size, bold);
    for (const part of doc.splitTextToSize(t, W - 8) as string[]) {
      doc.text(part, (W - doc.getTextWidth(part)) / 2, y);
      y += size * 0.45 + 1.5;
    }
  };
  const left = (t: string, size = 8, bold = false) => { font(size, bold); doc.text(t, 4, y); y += size * 0.45 + 1.5; };
  const lr = (l: string, r: string, size = 8, bold = false) => {
    font(size, bold); doc.text(l, 4, y); doc.text(r, W - 4 - doc.getTextWidth(r), y); y += size * 0.45 + 1.5;
  };
  const cols = (vals: string[], size = 7, bold = false) => {
    font(size, bold);
    const xs = vals.length === 3 ? [4, 34, 76] : [4, 30, 53, 76];
    vals.forEach((v, i) => i === 0 ? doc.text(v, xs[i], y) : doc.text(v, xs[i] - doc.getTextWidth(v), y));
    y += size * 0.45 + 1.5;
  };
  const dash = () => { for (let x = 4; x < W - 4; x += 3) doc.line(x, y, x + 1, y); y += 3.5; };
  const m = (n: number) => n.toFixed(2);
  const s = inv.store;

  center(s.business_name, 13, true);
  if (s.address) center(s.address, 7);
  if (s.phone) center(`Ph: ${s.phone}`, 7);
  if (s.email) center(s.email, 7);
  if (s.gstin) center(`GSTIN: ${s.gstin}`, 8, true);
  const st = stateName(s.state_code);
  if (st) center(`State: ${st} (${s.state_code})`, 7);
  dash();
  center('TAX INVOICE', 11, true);
  const d = new Date(inv.createdAt || Date.now());
  lr(`Bill: ${inv.invoiceNumber}`, d.toLocaleDateString('en-IN'), 8);
  if (inv.customerName) left(`Customer: ${inv.customerName}`, 8);
  if (inv.customerGstin) left(`Customer GSTIN: ${inv.customerGstin}`, 8);
  dash();
  for (const l of inv.lines) {
    left(l.name, 8, true);
    const info = `${l.quantity} x ${m(l.rate)}${l.discountPercent ? ` (-${l.discountPercent}%)` : ''}${l.hsn ? ` HSN ${l.hsn}` : ''} GST ${l.gstRate}%`;
    lr(info, m(l.total), 7);
  }
  dash();
  lr('Taxable value', m(inv.taxable), 8);
  if (inv.discount > 0) lr('(Discount given', `${m(inv.discount)})`, 7);
  if (inv.interstate) lr('IGST', m(inv.igst), 8);
  else { lr('CGST', m(inv.cgst), 8); lr('SGST', m(inv.sgst), 8); }
  dash();
  lr('TOTAL', `Rs.${m(inv.total)}`, 11, true);
  center(`Paid by ${inv.paymentMethod}`, 8);
  dash();
  center('GST summary', 8, true);
  if (inv.interstate) {
    cols(['GST%', 'Taxable', 'IGST'], 7, true);
    inv.taxRows.forEach(r => cols([`${r.rate}%`, m(r.taxable), m(r.igst)]));
  } else {
    cols(['GST%', 'Taxable', 'CGST', 'SGST'], 7, true);
    inv.taxRows.forEach(r => cols([`${r.rate}%`, m(r.taxable), m(r.cgst), m(r.sgst)]));
  }
  dash();
  center(s.bill_footer || 'Thank you for shopping! Visit again.', 7);
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