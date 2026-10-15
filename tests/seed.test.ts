import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
import { verifyPassword } from '../src/lib/auth';
import { rolePermissions } from '../src/lib/rbac';
import { report } from '../src/lib/reports';
import { manage } from '../src/lib/management';
import { operationsAction } from '../src/lib/operations';
import { assertTestSeedTarget, DEFAULT_SEED_PASSWORD, seedTestData } from '../scripts/seed-data';

afterAll(() => db.$disconnect());

describe('isolated test seed', () => {
  it('rejects production and invalid targets before touching data', async () => {
    const count = await db.user.count();
    for (const url of [
      undefined,
      'invalid',
      'file:///ccida_test',
      'postgresql://localhost/ccida',
      'postgresql://localhost/in-pos',
      'postgresql://localhost/ccida%2F_test',
    ])
      expect(() => assertTestSeedTarget(url)).toThrow();
    expect(assertTestSeedTarget('postgresql://localhost/ccida_test').database).toBe('ccida_test');
    vi.stubEnv('NODE_ENV', 'production');
    try {
      await expect(seedTestData()).rejects.toThrow('disabled in production');
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await db.user.count()).toBe(count);
  });

  it('seeds real workflows once, resumes safely, and preserves edited users and closed events', async () => {
    const namespace = `S${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
    const originalSettings = await db.promptPaySetting.findUnique({ where: { id: 'primary' } });
    const options = { namespace, promptPayPhone: '0812345678' };
    const results = await Promise.all([seedTestData(options), seedTestData(options)]);
    expect(results.map((result) => result.alreadyComplete).sort()).toEqual([false, true]);
    const first = results[0];
    expect(first.users).toHaveLength(6);
    expect(new Set(first.users.map((user) => user.role)).size).toBe(5);
    expect(first.registrations).toBe(6);
    expect(first.orders).toBe(5);
    const enabled = !originalSettings || originalSettings.enabled;
    expect(first.payments).toBe(enabled ? 1 : 0);
    if (originalSettings)
      expect(await db.promptPaySetting.findUnique({ where: { id: 'primary' } })).toEqual(
        originalSettings,
      );
    for (const [roleName, expected] of Object.entries(rolePermissions)) {
      const grants = await db.rolePermission.findMany({
        where: { roleName: roleName as keyof typeof rolePermissions },
      });
      expect(grants.map((grant) => grant.permissionKey)).toEqual(
        expect.arrayContaining([...expected]),
      );
    }
    const users = await db.user.findMany({
      where: { username: { startsWith: `${namespace.toLowerCase()}.` } },
      orderBy: { username: 'asc' },
    });
    for (const user of users)
      expect(verifyPassword(DEFAULT_SEED_PASSWORD, user.passwordHash)).toBe(true);
    expect(new Set(users.map((user) => user.passwordHash)).size).toBe(6);
    const superUser = users.find((user) => user.roleName === 'SUPER_ADMIN')!;
    const actor = { id: superUser.id, roleName: superUser.roleName };
    const summary = await report(actor, first.event.id);
    expect(summary.reconciled).toBe(true);
    expect(summary.netSalesSatang).toBe(26100);
    expect(summary.confirmedPaymentSatang).toBe(enabled ? 11000 : 0);
    expect(summary.outstandingSatang).toBe(enabled ? 15100 : 26100);
    const registrations = await db.registration.findMany({
      where: { eventId: first.event.id },
      include: { account: { include: { credentials: true } } },
    });
    expect(registrations.find((row) => row.notes?.endsWith(':blocked'))?.account?.status).toBe(
      'BLOCKED',
    );
    const reissued = registrations.find((row) => row.notes?.endsWith(':reissued'))!.account!;
    expect(reissued.credentials).toHaveLength(2);
    expect(reissued.credentials.filter((credential) => !credential.revokedAt)).toHaveLength(1);
    const cake = await db.product.findUniqueOrThrow({ where: { code: `${namespace}-CAKE` } });
    expect(
      (
        await db.inventory.findUniqueOrThrow({
          where: { eventId_productId: { eventId: first.event.id, productId: cake.id } },
        })
      ).remainingStock,
    ).toBe(29);
    if (enabled) {
      const payment = await db.payment.findFirstOrThrow({
        where: { eventId: first.event.id },
        include: { receipt: true, allocations: true },
      });
      expect(payment.status).toBe('CONFIRMED');
      expect(payment.receipt).not.toBeNull();
      expect(payment.allocations).toHaveLength(2);
    }
    const snapshot = async () => ({
      users: await db.user.findMany({
        where: { id: { in: users.map((user) => user.id) } },
        orderBy: { id: 'asc' },
      }),
      orders: await db.order.findMany({
        where: { eventId: first.event.id },
        include: { items: true },
        orderBy: { id: 'asc' },
      }),
      payments: await db.payment.findMany({
        where: { eventId: first.event.id },
        include: { allocations: true, receipt: true },
        orderBy: { id: 'asc' },
      }),
      inventories: await db.inventory.findMany({
        where: { eventId: first.event.id },
        orderBy: { id: 'asc' },
      }),
      registrations: await db.registration.count({ where: { eventId: first.event.id } }),
      credentials: await db.qrCredential.count({
        where: { account: { registration: { eventId: first.event.id } } },
      }),
      shifts: await db.shift.findMany({
        where: { eventId: first.event.id },
        orderBy: { id: 'asc' },
      }),
    });
    // Emulate interruption before the final completion marker; financial submissions replay.
    await db.systemSetting.update({
      where: { key: `test-seed:${namespace}:v1` },
      data: { value: { complete: false } },
    });
    const beforeResume = await snapshot();
    await seedTestData({ ...options, password: 'Different-test-password-2026!' });
    expect(await snapshot()).toEqual(beforeResume);
    const cashier = users.find((user) => user.roleName === 'CASHIER')!;
    const disable = {
      id: cashier.id,
      username: cashier.username,
      displayName: cashier.displayName,
      roleName: cashier.roleName,
      active: false,
      password: 'Changed-test-password-2026!',
    };
    await manage(actor, 'user.save', disable);
    expect(await db.shift.count({ where: { userId: cashier.id, closedAt: null } })).toBe(0);
    for (const shift of await db.shift.findMany({
      where: { eventId: first.event.id, closedAt: null },
    }))
      await operationsAction(actor, 'shift.close', {
        id: shift.id,
        reason: 'Seed rerun preservation check',
      });
    await manage(actor, 'user.save', disable);
    await operationsAction(actor, 'event.close', {
      eventId: first.event.id,
      allowOutstanding: true,
      reason: 'Test closing with outstanding balances',
    });
    const beforeRepeat = await snapshot();
    const repeated = await seedTestData(options);
    expect(repeated.alreadyComplete).toBe(true);
    expect(repeated.event.status).toBe('CLOSED');
    expect(await snapshot()).toEqual(beforeRepeat);
    const changed = await db.user.findUniqueOrThrow({ where: { id: cashier.id } });
    expect(changed.active).toBe(false);
    expect(verifyPassword('Changed-test-password-2026!', changed.passwordHash)).toBe(true);
  }, 60000);
});
