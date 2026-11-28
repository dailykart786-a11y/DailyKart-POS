import { describe, it, expect } from 'vitest';
import { roleLabel, ROLE_OPTIONS, DEFAULT_PERMISSIONS } from '@/lib/roles';

describe('roles', () => {
  describe('ROLE_OPTIONS', () => {
    it('should have 5 role options', () => {
      expect(ROLE_OPTIONS).toHaveLength(5);
    });

    it('should include admin, manager, cashier, inventory, accountant', () => {
      const values = ROLE_OPTIONS.map((r) => r.value);
      expect(values).toContain('admin');
      expect(values).toContain('manager');
      expect(values).toContain('cashier');
      expect(values).toContain('inventory');
      expect(values).toContain('accountant');
    });
  });

  describe('roleLabel', () => {
    it('should return the label for a known role', () => {
      expect(roleLabel('cashier')).toBe('Cashier');
      expect(roleLabel('admin')).toBe('Owner / Admin');
    });

    it('should return the role itself for unknown roles', () => {
      expect(roleLabel('unknown-role')).toBe('unknown-role');
    });
  });

  describe('DEFAULT_PERMISSIONS', () => {
    it('should have default permissions for non-admin roles', () => {
      expect(DEFAULT_PERMISSIONS.cashier).toContain('sales');
      expect(DEFAULT_PERMISSIONS.cashier).toContain('register');
      expect(DEFAULT_PERMISSIONS.cashier).toContain('khata');

      expect(DEFAULT_PERMISSIONS.manager).toContain('sales');
      expect(DEFAULT_PERMISSIONS.manager).toContain('products');
      expect(DEFAULT_PERMISSIONS.manager).toContain('stock');

      expect(DEFAULT_PERMISSIONS.inventory).toContain('products');
      expect(DEFAULT_PERMISSIONS.inventory).toContain('stock');
      expect(DEFAULT_PERMISSIONS.inventory).toContain('purchases');

      expect(DEFAULT_PERMISSIONS.accountant).toContain('expenses');
      expect(DEFAULT_PERMISSIONS.accountant).toContain('reports');
      expect(DEFAULT_PERMISSIONS.accountant).toContain('accounts');
    });
  });
});
