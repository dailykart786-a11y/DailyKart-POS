import { describe, it, expect } from 'vitest';
import {
  NOTES,
  COINS,
  emptyCount,
  notesTotal,
  coinsTotal,
  countTotal,
  countPieces,
  cleanCount,
  rupees,
} from '@/lib/cashCount';

describe('cashCount', () => {
  describe('NOTES and COINS', () => {
    it('should have Indian rupee denominations', () => {
      expect(NOTES).toEqual([500, 200, 100, 50, 20, 10]);
      expect(COINS).toEqual([20, 10, 5, 2, 1]);
    });
  });

  describe('emptyCount', () => {
    it('should return empty notes and coins', () => {
      const c = emptyCount();
      expect(c.notes).toEqual({});
      expect(c.coins).toEqual({});
    });
  });

  describe('countTotal', () => {
    it('should return 0 for empty count', () => {
      expect(countTotal(emptyCount())).toBe(0);
    });

    it('should sum notes and coins correctly', () => {
      const c = {
        notes: { '500': 2, '100': 3 },
        coins: { '10': 5, '2': 4 },
      };
      // 500*2 + 100*3 + 10*5 + 2*4 = 1000 + 300 + 50 + 8 = 1358
      expect(countTotal(c)).toBe(1358);
    });

    it('should handle null/undefined', () => {
      expect(countTotal(null)).toBe(0);
      expect(countTotal(undefined)).toBe(0);
    });
  });

  describe('notesTotal and coinsTotal', () => {
    it('should sum notes only', () => {
      const c = { notes: { '500': 1, '100': 2 }, coins: {} };
      expect(notesTotal(c)).toBe(700);
    });

    it('should sum coins only', () => {
      const c = { notes: {}, coins: { '10': 5, '5': 3 } };
      expect(coinsTotal(c)).toBe(65);
    });
  });

  describe('countPieces', () => {
    it('should count total number of notes and coins', () => {
      const c = { notes: { '500': 2, '100': 3 }, coins: { '10': 5 } };
      expect(countPieces(c)).toBe(10);
    });

    it('should return 0 for empty', () => {
      expect(countPieces(emptyCount())).toBe(0);
    });
  });

  describe('cleanCount', () => {
    it('should drop zero quantities', () => {
      const c = {
        notes: { '500': 0, '100': 2, '50': 0 },
        coins: { '10': 3, '2': 0 },
      };
      const cleaned = cleanCount(c);
      expect(cleaned.notes).toEqual({ '100': 2 });
      expect(cleaned.coins).toEqual({ '10': 3 });
    });

    it('should floor quantities to integers', () => {
      const c = {
        notes: { '100': 2.7 },
        coins: {},
      };
      const cleaned = cleanCount(c);
      expect(cleaned.notes).toEqual({ '100': 2 });
    });
  });

  describe('rupees', () => {
    it('should format as Indian rupees', () => {
      expect(rupees(1234.56)).toBe('₹1,234.56');
      expect(rupees(0)).toBe('₹0.00');
      expect(rupees(null)).toBe('₹0.00');
      expect(rupees(undefined)).toBe('₹0.00');
    });
  });
});
