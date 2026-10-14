import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { salesFixture } from './sales-helpers';
import { orderAction } from '../src/lib/orders';
import { paymentAction } from '../src/lib/payments';
import { controlAction } from '../src/lib/controls';
import { readData } from '../src/lib/data';
import { db } from '../src/lib/db';
afterAll(() => db.$disconnect());
describe('financial controls and audit', () => {
  it('rejects unauthorized voids, requires reasons, preserves financial/audit history', async () => {
    const f = await salesFixture();
    const order = (await orderAction(f.actors.CASHIER, 'order.create', f.orderInput())) as {
      id: string;
    };
    await expect(
      controlAction(f.actors.CASHIER, 'order.void', {
        id: order.id,
        key: randomUUID(),
        reason: 'Mistake',
      }),
    ).rejects.toThrow('not authorized');
    await expect(
      controlAction(f.actors.SUPER_ADMIN, 'order.void', {
        id: order.id,
        key: randomUUID(),
        reason: ' ',
      }),
    ).rejects.toThrow();
    await controlAction(f.actors.SUPER_ADMIN, 'order.void', {
      id: order.id,
      key: randomUUID(),
      reason: 'Wrong product',
    });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('VOIDED');
    expect(await db.orderItem.count({ where: { orderId: order.id } })).toBe(1);
    const log = await db.auditLog.findFirstOrThrow({
      where: { entityId: order.id, action: 'ORDER_VOID' },
    });
    expect(log.reason).toBe('Wrong product');
    await expect(
      db.auditLog.update({ where: { id: log.id }, data: { reason: 'tampered' } }),
    ).rejects.toThrow('append-only');
    await expect(db.order.delete({ where: { id: order.id } })).rejects.toThrow('append-only');
    await expect(
      db.orderItem.updateMany({
        where: { orderId: order.id },
        data: { productNameSnapshot: 'tampered' },
      }),
    ).rejects.toThrow('append-only');
  });
  it('voids payment, preserves allocations/receipt, restores exact outstanding and allows repayment', async () => {
    const f = await salesFixture();
    await paymentAction(f.actors.SUPER_ADMIN, 'promptpay.save', {
      type: 'PHONE',
      identifier: '0812345678',
      displayName: 'TEST ONLY',
      enabled: true,
    });
    const o = (await orderAction(f.actors.CASHIER, 'order.create', f.orderInput(2))) as {
      id: string;
    };
    const p = (await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
      eventId: f.event.id,
      stationId: f.stations[3].id,
      token: f.registration.token,
      key: randomUUID(),
    })) as { id: string };
    await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', {
      paymentId: p.id,
      stationId: f.stations[3].id,
      key: randomUUID(),
      reference: randomUUID(),
      evidence: 'Verified evidence',
      evidenceVerified: true,
    });
    await expect(
      controlAction(f.actors.SUPER_ADMIN, 'order.void', {
        id: o.id,
        key: randomUUID(),
        reason: 'Wrong line',
      }),
    ).rejects.toThrow('Void its confirmed payment first');
    await expect(
      controlAction(f.actors.PAYMENT_CASHIER, 'payment.void', {
        id: p.id,
        key: randomUUID(),
        reason: 'Wrong transfer',
      }),
    ).rejects.toThrow('not authorized');
    const request = { id: p.id, key: randomUUID(), reason: 'Incorrect transfer verification' };
    await controlAction(f.actors.SUPER_ADMIN, 'payment.void', request);
    await controlAction(f.actors.SUPER_ADMIN, 'payment.void', request);
    expect(await db.paymentAllocation.count({ where: { paymentId: p.id } })).toBe(1);
    expect(await db.receipt.count({ where: { paymentId: p.id } })).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('RECORDED');
    expect(
      (
        (await orderAction(f.actors.PAYMENT_CASHIER, 'account.lookup', {
          eventId: f.event.id,
          token: f.registration.token,
        })) as { outstandingSatang: number }
      ).outstandingSatang,
    ).toBe(9100);
    await expect(
      paymentAction(f.actors.PAYMENT_CASHIER, 'receipt.print', { paymentId: p.id }),
    ).rejects.toThrow('Only confirmed');
    const next = (await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
      eventId: f.event.id,
      stationId: f.stations[3].id,
      token: f.registration.token,
      key: randomUUID(),
    })) as { id: string };
    expect(next.id).not.toBe(p.id);
  });
  it('denies sensitive reads and enforces permission checks before input parsing', async () => {
    const f = await salesFixture();
    for (const role of ['ADMIN', 'CASHIER', 'PAYMENT_CASHIER'] as const) {
      await expect(readData(f.actors[role], 'audit')).rejects.toThrow('not authorized');
      await expect(readData(f.actors[role], 'users')).rejects.toThrow('not authorized');
      await expect(controlAction(f.actors[role], 'account.reopen', {})).rejects.toThrow(
        'not authorized',
      );
      await expect(controlAction(f.actors[role], 'payment.void', {})).rejects.toThrow(
        'not authorized',
      );
      await expect(paymentAction(f.actors[role], 'promptpay.save', {})).rejects.toThrow(
        'not authorized',
      );
    }
    await expect(readData(f.actors.ADMIN, 'products')).rejects.toThrow('not authorized');
    await expect(readData(f.actors.PAYMENT_CASHIER, 'products')).rejects.toThrow('not authorized');
    await expect(readData(f.actors.ADMIN, 'orders', f.event.id)).rejects.toThrow('not authorized');
  });
});
