import { describe, it, expect } from 'vitest';
import {
  estimateLeft,
  batchesWithLeft,
  daysUntil,
  todayIso,
  type Batch,
} from '@/lib/batches';

describe('batches', () => {
  const makeBatch = (overrides: Partial<Batch> = {}): Batch => ({
    id: 'batch-1',
    product_id: 'product-1',
    batch_no: 'BATCH-001',
    expiry_date: '2027-12-31',
    quantity: 100,
    created_at: '2026-01-01T00:00:00Z',
    cleared_at: null,
    ...overrides,
  });

  describe('estimateLeft', () => {
    it('should return empty array for no batches', () => {
      expect(estimateLeft([], 50)).toEqual([]);
    });

    it('should assign all stock to a single batch', () => {
      const batches = [makeBatch({ quantity: 100 })];
      const result = estimateLeft(batches, 60);
      expect(result).toHaveLength(1);
      expect(result[0].left).toBe(60);
    });

    it('should not assign more than batch quantity', () => {
      const batches = [makeBatch({ quantity: 10 })];
      const result = estimateLeft(batches, 60);
      expect(result[0].left).toBe(10);
    });

    it('should split stock across multiple batches newest first', () => {
      const batches = [
        makeBatch({ id: 'old', created_at: '2026-01-01T00:00:00Z', quantity: 50 }),
        makeBatch({ id: 'new', created_at: '2026-06-01T00:00:00Z', quantity: 50 }),
      ];
      const result = estimateLeft(batches, 60);
      // Newest first: new batch gets 50, old gets 10
      expect(result[0].id).toBe('new');
      expect(result[0].left).toBe(50);
      expect(result[1].id).toBe('old');
      expect(result[1].left).toBe(10);
    });

    it('should exclude cleared batches', () => {
      const batches = [
        makeBatch({ id: 'cleared', cleared_at: '2026-01-02T00:00:00Z', quantity: 100 }),
        makeBatch({ id: 'active', quantity: 100 }),
      ];
      const result = estimateLeft(batches, 30);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('active');
    });

    it('should handle zero stock', () => {
      const batches = [makeBatch({ quantity: 100 })];
      const result = estimateLeft(batches, 0);
      expect(result[0].left).toBe(0);
    });
  });

  describe('batchesWithLeft', () => {
    it('should group batches by product and estimate left', () => {
      const batches: Batch[] = [
        makeBatch({ id: 'b1', product_id: 'p1', quantity: 100 }),
        makeBatch({ id: 'b2', product_id: 'p2', quantity: 50 }),
      ];
      const stockById = { p1: 30, p2: 20 };
      const result = batchesWithLeft(batches, stockById);
      expect(result).toHaveLength(2);
      expect(result.find((b) => b.product_id === 'p1')?.left).toBe(30);
      expect(result.find((b) => b.product_id === 'p2')?.left).toBe(20);
    });

    it('should handle missing product stock', () => {
      const batches: Batch[] = [makeBatch({ id: 'b1', product_id: 'p1', quantity: 100 })];
      const result = batchesWithLeft(batches, {});
      expect(result[0].left).toBe(0);
    });
  });

  describe('daysUntil', () => {
    it('should return positive days for future dates', () => {
      const today = todayIso();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().slice(0, 10);
      expect(daysUntil(tomorrowStr)).toBe(1);
    });

    it('should return 0 for today', () => {
      expect(daysUntil(todayIso())).toBe(0);
    });

    it('should return negative days for past dates', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);
      expect(daysUntil(yesterdayStr)).toBe(-1);
    });
  });

  describe('todayIso', () => {
    it('should return today in YYYY-MM-DD format', () => {
      const result = todayIso();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result).toBe(new Date().toISOString().slice(0, 10));
    });
  });
});
