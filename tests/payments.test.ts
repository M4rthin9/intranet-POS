import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { salesFixture } from './sales-helpers';
import { orderAction } from '../src/lib/orders';
import { paymentAction } from '../src/lib/payments';
import { promptPayPayload, crc16 } from '../src/lib/promptpay';
import { db } from '../src/lib/db';
import type { Actor } from '../src/lib/audit';
afterAll(() => db.$disconnect());
export async function enablePromptpay(actor: Actor) {
  await paymentAction(actor, 'promptpay.save', {
    type: 'PHONE',
    identifier: '0812345678',
    displayName: 'TEST RECIPIENT ONLY',
    enabled: true,
  });
}
describe('PromptPay settlement', () => {
  it('encodes standard fields with exact decimals and CRC', () => {
    expect(crc16('123456789')).toBe('29B1');
    const p = promptPayPayload('PHONE', '0812345678', 60000);
    expect(p).toContain('010212');
    expect(p).toContain('01130066812345678');
    expect(p).toContain('5406600.00');
    expect(p.slice(-8, -4)).toBe('6304');
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
    expect(() => promptPayPayload('PHONE', '123', 1)).toThrow();
  });
  it('aggregates two stations, confirms, allocates, prints and rejects repayment', async () => {
    const f = await salesFixture();
    await enablePromptpay(f.actors.SUPER_ADMIN);
    await orderAction(f.actors.CASHIER, 'order.create', f.orderInput());
    await orderAction(f.secondCashier, 'order.create', {
      ...f.orderInput(2),
      stationId: f.stations[2].id,
    });
    const generate = {
      eventId: f.event.id,
      stationId: f.stations[3].id,
      token: f.registration.token,
      key: randomUUID(),
    };
    const p = (await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
      ...generate,
      amountSatang: 1,
    })) as { id: string; amountSatang: number; status: string; qrPayload: string };
    expect(p.amountSatang).toBe(13650);
    expect(p.status).toBe('AWAITING_CONFIRMATION');
    expect(p.qrPayload).toContain('5406136.50');
    expect(
      (await db.customerAccount.findUniqueOrThrow({ where: { id: f.registration.account.id } }))
        .status,
    ).toBe('ACTIVE');
    await expect(orderAction(f.actors.CASHIER, 'order.create', f.orderInput())).rejects.toThrow(
      'Payment is in progress',
    );
    const same = (await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
      ...generate,
      key: randomUUID(),
    })) as { id: string };
    expect(same.id).toBe(p.id);
    const confirm = {
      paymentId: p.id,
      stationId: f.stations[3].id,
      key: randomUUID(),
      reference: randomUUID(),
      evidence: 'Verified recipient, exact amount and timestamp',
      evidenceVerified: true,
    };
    await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', confirm);
    await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', confirm);
    const allocations = await db.paymentAllocation.findMany({ where: { paymentId: p.id } });
    expect(allocations.length).toBe(2);
    expect(allocations.reduce((a, x) => a + x.amountSatang, 0)).toBe(13650);
    expect(
      await db.order.count({ where: { accountId: f.registration.account.id, status: 'PAID' } }),
    ).toBe(2);
    expect(
      (await db.customerAccount.findUniqueOrThrow({ where: { id: f.registration.account.id } }))
        .status,
    ).toBe('SETTLED');
    await expect(
      paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
        ...generate,
        key: randomUUID(),
      }),
    ).rejects.toThrow('SETTLED');
    const first = (await paymentAction(f.actors.PAYMENT_CASHIER, 'receipt.print', {
      paymentId: p.id,
    })) as { copy: boolean };
    const second = (await paymentAction(f.actors.PAYMENT_CASHIER, 'receipt.print', {
      paymentId: p.id,
    })) as { copy: boolean };
    expect(first.copy).toBe(false);
    expect(second.copy).toBe(true);
    expect(
      await db.auditLog.count({ where: { eventId: f.event.id, action: 'RECEIPT_REPRINT' } }),
    ).toBe(1);
    await expect(paymentAction(f.actors.CASHIER, 'payment.confirm', confirm)).rejects.toThrow(
      'not authorized',
    );
    await expect(paymentAction(f.actors.ADMIN, 'payment.generate', generate)).rejects.toThrow(
      'not authorized',
    );
  });
  it('serializes simultaneous ordering/payment and duplicate confirmation', async () => {
    const f = await salesFixture();
    await enablePromptpay(f.actors.SUPER_ADMIN);
    await orderAction(f.actors.CASHIER, 'order.create', f.orderInput());
    const [generated, ordered] = await Promise.allSettled([
      paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
        eventId: f.event.id,
        stationId: f.stations[3].id,
        token: f.registration.token,
        key: randomUUID(),
      }),
      orderAction(f.secondCashier, 'order.create', {
        ...f.orderInput(),
        stationId: f.stations[2].id,
      }),
    ]);
    expect(generated.status).toBe('fulfilled');
    const p = (generated as PromiseFulfilledResult<unknown>).value as {
      id: string;
      amountSatang: number;
    };
    const outstanding = await db.order.aggregate({
      where: { accountId: f.registration.account.id, status: 'RECORDED' },
      _sum: { totalSatang: true },
    });
    expect(p.amountSatang).toBe(outstanding._sum.totalSatang);
    if (ordered.status === 'rejected')
      expect(ordered.reason.message).toContain('Payment is in progress');
    const confirm = {
      paymentId: p.id,
      stationId: f.stations[3].id,
      key: randomUUID(),
      reference: randomUUID(),
      evidence: 'Verified bank evidence',
      evidenceVerified: true,
    };
    await Promise.all([
      paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', confirm),
      paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', { ...confirm, key: randomUUID() }),
    ]);
    expect(await db.auditLog.count({ where: { entityId: p.id, action: 'PAYMENT_CONFIRM' } })).toBe(
      1,
    );
  });
});
