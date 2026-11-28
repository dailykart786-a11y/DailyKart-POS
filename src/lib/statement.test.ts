import { describe, it, expect } from 'vitest';
import { rupees, withRunning, dueInfo, statementRows, type LedgerEntry } from '@/lib/statement';

describe('statement', () => {
  const makeEntry = (overrides: Partial<LedgerEntry> = {}): LedgerEntry => ({
    id: 'entry-1',
    at: '2026-01-15T10:00:00Z',
    kind: 'sale',
    label: 'Bill INV-001',
    debit: 100,
    credit: 0,
    ...overrides,
  });

  describe('rupees', () => {
    it('should format as Indian rupees', () => {
      expect(rupees(1234.56)).toBe('₹1,234.56');
      expect(rupees(0)).toBe('₹0.00');
      expect(rupees(null)).toBe('₹0.00');
    });
  });

  describe('withRunning', () => {
    it('should compute running balance', () => {
      const entries: LedgerEntry[] = [
        makeEntry({ id: 'e1', at: '2026-01-10T00:00:00Z', debit: 100, credit: 0 }),
        makeEntry({ id: 'e2', at: '2026-01-12T00:00:00Z', debit: 0, credit: 30 }),
        makeEntry({ id: 'e3', at: '2026-01-15T00:00:00Z', debit: 50, credit: 0 }),
      ];
      const result = withRunning(entries);
      expect(result).toHaveLength(3);
      expect(result[0].running).toBe(100);
      expect(result[1].running).toBe(70);
      expect(result[2].running).toBe(120);
    });

    it('should not count reversed entries in running balance', () => {
      const entries: LedgerEntry[] = [
        makeEntry({ id: 'e1', at: '2026-01-10T00:00:00Z', debit: 100, credit: 0 }),
        makeEntry({
          id: 'e2',
          at: '2026-01-12T00:00:00Z',
          debit: 0,
          credit: 30,
          reversed: { at: '2026-01-13T00:00:00Z', reason: 'duplicate' },
        }),
      ];
      const result = withRunning(entries);
      expect(result[0].running).toBe(100);
      expect(result[1].running).toBe(100); // reversed, no change
    });

    it('should sort opening entries first', () => {
      const entries: LedgerEntry[] = [
        makeEntry({ id: 'e1', at: '2026-01-15T00:00:00Z', kind: 'sale', debit: 50, credit: 0 }),
        makeEntry({ id: 'opening', at: '2000-01-01T00:00:00Z', kind: 'opening', debit: 200, credit: 0 }),
      ];
      const result = withRunning(entries);
      expect(result[0].kind).toBe('opening');
      expect(result[0].running).toBe(200);
      expect(result[1].running).toBe(250);
    });

    it('should handle empty array', () => {
      expect(withRunning([])).toEqual([]);
    });
  });

  describe('dueInfo', () => {
    it('should return null when no due date or credit days', () => {
      expect(dueInfo(null, null)).toBeNull();
      expect(dueInfo('2026-01-01T00:00:00Z', null)).toBeNull();
      expect(dueInfo(null, 30)).toBeNull();
    });

    it('should compute overdue days', () => {
      // 40 days ago
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 40);
      const pastStr = pastDate.toISOString();
      const result = dueInfo(pastStr, 30);
      expect(result).not.toBeNull();
      expect(result?.overdueDays).toBeGreaterThanOrEqual(9);
      expect(result?.overdueDays).toBeLessThanOrEqual(11);
    });

    it('should return null when not overdue', () => {
      // 10 days from now
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      const futureStr = futureDate.toISOString();
      const result = dueInfo(futureStr, 30);
      expect(result?.overdueDays).toBeLessThanOrEqual(0);
    });
  });

  describe('statementRows', () => {
    it('should compute brought forward and closing balance', () => {
      const entries: LedgerEntry[] = [
        makeEntry({ id: 'e1', at: '2026-01-05T00:00:00Z', debit: 100, credit: 0 }),
        makeEntry({ id: 'e2', at: '2026-01-10T00:00:00Z', debit: 0, credit: 30 }),
        makeEntry({ id: 'e3', at: '2026-01-20T00:00:00Z', debit: 50, credit: 0 }),
      ];
      const result = statementRows(entries, '2026-01-01', '2026-01-31');
      expect(result.brought).toBe(0);
      expect(result.rows).toHaveLength(3);
      expect(result.closing).toBe(120);
    });

    it('should compute brought forward from entries before range', () => {
      const entries: LedgerEntry[] = [
        makeEntry({ id: 'e1', at: '2025-12-20T00:00:00Z', debit: 100, credit: 0 }),
        makeEntry({ id: 'e2', at: '2026-01-10T00:00:00Z', debit: 0, credit: 30 }),
      ];
      const result = statementRows(entries, '2026-01-01', '2026-01-31');
      expect(result.brought).toBe(100);
      expect(result.rows).toHaveLength(1);
      expect(result.closing).toBe(70);
    });
  });
});
