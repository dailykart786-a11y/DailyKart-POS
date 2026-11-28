import { describe, it, expect } from 'vitest';
import {
  split,
  add,
  ZERO,
  totalTax,
  byRate,
  sum,
  hsnSummary,
  b2bInvoices,
  toCsv,
  type SaleLine,
  type ReturnLine,
  type TaxSplit,
} from '@/lib/gstReport';

describe('gstReport', () => {
  const makeSale = (overrides: Partial<SaleLine> = {}): SaleLine => ({
    invoice: 'INV-001',
    date: '2026-01-15T10:00:00Z',
    interstate: false,
    customerName: 'John',
    customerGstin: null,
    customerState: null,
    hsn: '3001',
    rate: 18,
    quantity: 2,
    taxable: 100,
    tax: 18,
    ...overrides,
  });

  describe('split', () => {
    it('should split intrastate tax equally between CGST and SGST', () => {
      const result = split(100, 18, false);
      expect(result).toEqual({ taxable: 100, cgst: 9, sgst: 9, igst: 0 });
    });

    it('should put all tax in IGST for interstate', () => {
      const result = split(100, 18, true);
      expect(result).toEqual({ taxable: 100, cgst: 0, sgst: 0, igst: 18 });
    });
  });

  describe('add', () => {
    it('should add two tax splits', () => {
      const a: TaxSplit = { taxable: 100, cgst: 9, sgst: 9, igst: 0 };
      const b: TaxSplit = { taxable: 50, cgst: 4.5, sgst: 4.5, igst: 0 };
      const result = add(a, b);
      expect(result).toEqual({ taxable: 150, cgst: 13.5, sgst: 13.5, igst: 0 });
    });
  });

  describe('totalTax', () => {
    it('should sum cgst, sgst, igst', () => {
      const t: TaxSplit = { taxable: 100, cgst: 9, sgst: 9, igst: 18 };
      expect(totalTax(t)).toBe(36);
    });
  });

  describe('sum', () => {
    it('should sum multiple sale lines', () => {
      const lines: SaleLine[] = [
        makeSale({ taxable: 100, tax: 18, interstate: false }),
        makeSale({ taxable: 200, tax: 36, interstate: false, invoice: 'INV-002' }),
      ];
      const result = sum(lines);
      expect(result).toEqual({ taxable: 300, cgst: 27, sgst: 27, igst: 0 });
    });

    it('should return ZERO for empty array', () => {
      expect(sum([])).toEqual(ZERO);
    });
  });

  describe('byRate', () => {
    it('should group lines by GST rate', () => {
      const lines: SaleLine[] = [
        makeSale({ rate: 5, taxable: 100, tax: 5 }),
        makeSale({ rate: 18, taxable: 200, tax: 36, invoice: 'INV-002' }),
        makeSale({ rate: 5, taxable: 50, tax: 2.5, invoice: 'INV-003' }),
      ];
      const result = byRate(lines);
      expect(result).toHaveLength(2);
      const rate5 = result.find((r) => r.rate === 5);
      expect(rate5?.taxable).toBe(150);
      const rate18 = result.find((r) => r.rate === 18);
      expect(rate18?.taxable).toBe(200);
    });
  });

  describe('hsnSummary', () => {
    it('should summarize sales and subtract returns by HSN', () => {
      const sales: SaleLine[] = [
        makeSale({ hsn: '3001', rate: 12, quantity: 10, taxable: 100, tax: 12 }),
      ];
      const returns: ReturnLine[] = [
        {
          ...makeSale({ hsn: '3001', rate: 12, quantity: 2, taxable: 20, tax: 2.4 }),
          creditNote: 'CN-001',
        },
      ];
      const result = hsnSummary(sales, returns);
      expect(result).toHaveLength(1);
      expect(result[0].hsn).toBe('3001');
      expect(result[0].quantity).toBe(8);
    });

    it('should label missing HSN as NO HSN', () => {
      const sales: SaleLine[] = [makeSale({ hsn: null })];
      const result = hsnSummary(sales, []);
      expect(result[0].hsn).toBe('NO HSN');
    });
  });

  describe('b2bInvoices', () => {
    it('should only include invoices with customer GSTIN', () => {
      const lines: SaleLine[] = [
        makeSale({ customerGstin: '22AAAAA0000A1Z5', invoice: 'INV-B2B' }),
        makeSale({ customerGstin: null, invoice: 'INV-B2C' }),
      ];
      const result = b2bInvoices(lines);
      expect(result).toHaveLength(1);
      expect(result[0].invoice).toBe('INV-B2B');
    });
  });

  describe('toCsv', () => {
    it('should convert rows to CSV', () => {
      const rows = [{ a: 1, b: 'x' }, { a: 2, b: 'y' }];
      const csv = toCsv(rows);
      expect(csv).toContain('a,b');
      expect(csv).toContain('1,x');
      expect(csv).toContain('2,y');
    });

    it('should return empty string for no rows', () => {
      expect(toCsv([])).toBe('');
    });
  });
});
