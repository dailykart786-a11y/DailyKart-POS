import { describe, it, expect } from 'vitest';
import { isValidGstin, stateName, makeLine, buildInvoice, receiptText } from '@/lib/invoice';
import type { InvoiceLine, StoreDetails } from '@/lib/invoice';

describe('invoice', () => {
  describe('isValidGstin', () => {
    it('should validate a correct GSTIN', () => {
      expect(isValidGstin('22AAAAA0000A1Z5')).toBe(true);
      expect(isValidGstin('27AAAAA0000A1Z5')).toBe(true);
    });

    it('should reject invalid GSTINs', () => {
      expect(isValidGstin('')).toBe(false);
      expect(isValidGstin('INVALID')).toBe(false);
      expect(isValidGstin('22AAAAA0000A1Z')).toBe(false); // too short
      expect(isValidGstin('22aaaaa0000a1z5')).toBe(true); // lowercase should work (trimmed+uppercased)
    });
  });

  describe('stateName', () => {
    it('should return state name for valid code', () => {
      expect(stateName('07')).toBe('Delhi');
      expect(stateName('29')).toBe('Karnataka');
    });

    it('should return null for unknown code', () => {
      expect(stateName('99')).toBeNull();
      expect(stateName(null)).toBeNull();
      expect(stateName(undefined)).toBeNull();
    });
  });

  describe('makeLine', () => {
    it('should compute taxable, GST, and total correctly', () => {
      const line = makeLine({
        name: 'Product A',
        quantity: 2,
        rate: 100,
        discountPercent: 10,
        gstRate: 18,
      });
      // base = 200, discount = 20, taxable = 180, gst = 32.4, total = 212.4
      expect(line.taxable).toBe(180);
      expect(line.gstAmount).toBe(32.4);
      expect(line.total).toBe(212.4);
      expect(line.discountPercent).toBe(10);
    });

    it('should clamp discount between 0 and 100', () => {
      const line = makeLine({
        name: 'Product A',
        quantity: 1,
        rate: 100,
        discountPercent: 150,
        gstRate: 18,
      });
      expect(line.discountPercent).toBe(100);
      expect(line.taxable).toBe(0);
    });

    it('should default gstRate to 0', () => {
      const line = makeLine({
        name: 'Product A',
        quantity: 1,
        rate: 100,
      });
      expect(line.gstRate).toBe(0);
      expect(line.gstAmount).toBe(0);
      expect(line.total).toBe(100);
    });
  });

  describe('buildInvoice', () => {
    const store: StoreDetails = {
      business_name: 'Test Shop',
      address: '123 Main St',
      phone: '+91-9999999999',
      email: 'test@shop.com',
      gstin: '22AAAAA0000A1Z5',
      state_code: '07',
      bill_footer: 'Thank you!',
    };

    const lines: InvoiceLine[] = [
      {
        name: 'Product A',
        hsn: '3001',
        quantity: 2,
        rate: 100,
        discountPercent: 0,
        taxable: 200,
        gstRate: 18,
        gstAmount: 36,
        total: 236,
      },
    ];

    it('should build an invoice with correct totals', () => {
      const inv = buildInvoice({
        store,
        invoiceNumber: 'INV-001',
        createdAt: '2026-01-15T10:00:00Z',
        paymentMethod: 'cash',
        lines,
      });
      expect(inv.invoiceNumber).toBe('INV-001');
      expect(inv.taxable).toBe(200);
      expect(inv.cgst).toBe(18);
      expect(inv.sgst).toBe(18);
      expect(inv.igst).toBe(0);
      expect(inv.totalTax).toBe(36);
      expect(inv.total).toBe(236);
      expect(inv.paymentMethod).toBe('CASH');
    });

    it('should compute IGST for interstate invoices', () => {
      const inv = buildInvoice({
        store,
        invoiceNumber: 'INV-002',
        createdAt: '2026-01-15T10:00:00Z',
        paymentMethod: 'upi',
        interstate: true,
        lines,
      });
      expect(inv.cgst).toBe(0);
      expect(inv.sgst).toBe(0);
      expect(inv.igst).toBe(36);
      expect(inv.interstate).toBe(true);
    });

    it('should use saved total if provided', () => {
      const inv = buildInvoice({
        store,
        invoiceNumber: 'INV-003',
        createdAt: '2026-01-15T10:00:00Z',
        paymentMethod: 'card',
        lines,
        total: 250,
      });
      expect(inv.total).toBe(250);
    });
  });

  describe('receiptText', () => {
    it('should generate plain text receipt', () => {
      const store: StoreDetails = {
        business_name: 'Test Shop',
        address: null,
        phone: '+91-9999999999',
        email: null,
        gstin: null,
        state_code: null,
        bill_footer: null,
      };
      const lines: InvoiceLine[] = [
        {
          name: 'Product A',
          hsn: null,
          quantity: 2,
          rate: 100,
          discountPercent: 0,
          taxable: 200,
          gstRate: 18,
          gstAmount: 36,
          total: 236,
        },
      ];
      const inv = buildInvoice({
        store,
        invoiceNumber: 'INV-001',
        createdAt: '2026-01-15T10:00:00Z',
        paymentMethod: 'cash',
        lines,
      });
      const text = receiptText(inv);
      expect(text).toContain('Test Shop');
      expect(text).toContain('INV-001');
      expect(text).toContain('Product A');
      expect(text).toContain('₹236.00');
    });
  });
});
