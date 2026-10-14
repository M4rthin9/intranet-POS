import { describe, it, expect } from 'vitest';
import { can, requirePermission } from '../src/lib/rbac';
import { hashPassword, verifyPassword } from '../src/lib/auth';
import { requestKey } from '../src/lib/client-key';
describe('security foundation', () => {
  it('creates secure UUID v4 request keys without a secure-context-only API', () => {
    const first = requestKey();
    expect(first).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(requestKey()).not.toBe(first);
  });
  it('enforces the four roles on the server', () => {
    expect(can('ADMIN', 'order.create')).toBe(false);
    expect(can('CASHIER', 'payment.confirm')).toBe(false);
    expect(can('PAYMENT_CASHIER', 'registration.create')).toBe(false);
    expect(can('SUPER_ADMIN', 'settings.manage')).toBe(true);
    expect(() => requirePermission('CASHIER', 'order.void')).toThrow();
  });
  it('uses salted password hashes and verifies correctly', () => {
    const hash = hashPassword('StrongPassword123!');
    expect(hash).not.toEqual(hashPassword('StrongPassword123!'));
    expect(verifyPassword('StrongPassword123!', hash)).toBe(true);
    expect(verifyPassword('wrong', hash)).toBe(false);
  });
});
