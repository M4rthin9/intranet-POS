import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { salesFixture } from './sales-helpers';
import { db } from '../src/lib/db';
import { orderAction } from '../src/lib/orders';
import { paymentAction } from '../src/lib/payments';
import { registrationAction } from '../src/lib/registration';
import { controlAction } from '../src/lib/controls';
import { paymentStatement } from '../src/lib/payment-statement';
import type { ReceiptDto } from '../src/components/types';
type TestPayment = { id: string; number: string; method: string; qrImage?: string };

afterAll(() => db.$disconnect());
afterEach(() => vi.useRealTimers());
describe('cash settlement and payment statements', () => {
  it('requires cash in full, issues a cash receipt with change and safely retries confirmation', async () => {
    const f = await salesFixture();
    await orderAction(f.actors.CASHIER, 'order.create', f.orderInput(2));
    const input = {
      eventId: f.event.id,
      stationId: f.stations[3].id,
      token: f.registration.token,
      key: randomUUID(),
      method: 'CASH',
    };
    const payment = (await paymentAction(
      f.actors.PAYMENT_CASHIER,
      'payment.generate',
      input,
    )) as TestPayment;
    expect(payment.method).toBe('CASH');
    expect(payment.qrImage).toBeUndefined();
    expect(
      ((await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', input)) as TestPayment)
        .id,
    ).toBe(payment.id);
    await expect(
      paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
        ...input,
        key: randomUUID(),
        method: 'PROMPTPAY',
      }),
    ).rejects.toThrow('another method');
    await expect(
      paymentAction(f.actors.PAYMENT_CASHIER, 'payment.qr.print', {
        paymentId: payment.id,
        stationId: f.stations[3].id,
      }),
    ).rejects.toThrow('Cash payments');
    await expect(
      paymentAction(f.actors.PAYMENT_CASHIER, 'receipt.print', { paymentId: payment.id }),
    ).rejects.toThrow();
    expect(await db.receipt.count({ where: { paymentId: payment.id } })).toBe(0);
    const confirm = {
      paymentId: payment.id,
      stationId: f.stations[3].id,
      key: randomUUID(),
      reference: `CASH-${payment.number}`,
      evidence: 'Cash checked',
      evidenceVerified: true,
    };
    await expect(
      paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', confirm),
    ).rejects.toThrow('Cash received');
    await expect(
      paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', {
        ...confirm,
        cashReceivedSatang: 9000,
      }),
    ).rejects.toThrow('Cash received');
    const paid = { ...confirm, cashReceivedSatang: 10000 };
    await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', paid);
    await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', paid);
    const receipt = (await paymentAction(f.actors.PAYMENT_CASHIER, 'receipt.print', {
      paymentId: payment.id,
    })) as ReceiptDto;
    expect(receipt.snapshot).toMatchObject({
      method: 'CASH',
      amountSatang: 9100,
      cashReceivedSatang: 10000,
      changeSatang: 900,
      reference: `CASH-${payment.number}`,
    });
    expect(await db.receipt.count({ where: { paymentId: payment.id } })).toBe(1);
    expect(await db.paymentAllocation.count({ where: { paymentId: payment.id } })).toBe(1);
    expect(
      (await db.customerAccount.findUniqueOrThrow({ where: { id: f.registration.account.id } }))
        .status,
    ).toBe('SETTLED');
  });

  it('separates methods, orders statement rows by Thai confirmation dates and excludes pending and voided receipts', async () => {
    const f = await salesFixture();
    const base = { eventId: f.event.id, stationId: f.stations[3].id };
    await orderAction(f.actors.CASHIER, 'order.create', f.orderInput());
    const cash = (await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
      ...base,
      token: f.registration.token,
      key: randomUUID(),
      method: 'CASH',
    })) as TestPayment;
    expect((await paymentStatement(f.actors.SUPER_ADMIN, f.event.id)).rows).toHaveLength(0);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T16:59:59Z'));
    await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', {
      ...base,
      paymentId: cash.id,
      key: randomUUID(),
      reference: 'cash-test',
      evidence: 'Cash checked',
      evidenceVerified: true,
      cashReceivedSatang: 5000,
    });
    const other = (await registrationAction(f.actors.ADMIN, 'registration.create', {
      eventId: f.event.id,
      stationId: f.stations[0].id,
      customerName: 'Bank transfer customer',
    })) as { token: string };
    await orderAction(f.actors.CASHIER, 'order.create', { ...f.orderInput(2), token: other.token });
    await paymentAction(f.actors.SUPER_ADMIN, 'promptpay.save', {
      type: 'PHONE',
      identifier: '0812345678',
      displayName: 'TEST ONLY',
      enabled: true,
    });
    const qr = (await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
      ...base,
      token: other.token,
      key: randomUUID(),
    })) as TestPayment;
    await expect(
      paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', {
        ...base,
        paymentId: qr.id,
        key: randomUUID(),
        reference: randomUUID(),
        evidence: 'Verified bank transfer',
        evidenceVerified: true,
        cashReceivedSatang: 10000,
      }),
    ).rejects.toThrow('only valid for cash');
    vi.setSystemTime(new Date('2026-10-15T17:00:00Z'));
    await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', {
      ...base,
      paymentId: qr.id,
      key: randomUUID(),
      reference: randomUUID(),
      evidence: 'Verified bank transfer',
      evidenceVerified: true,
    });
    const all = await paymentStatement(f.actors.SUPER_ADMIN, f.event.id);
    expect(all).toMatchObject({
      openingSatang: 0,
      cashSatang: 4550,
      promptPaySatang: 9100,
      receivedSatang: 13650,
      closingSatang: 13650,
    });
    expect(all.rows.map((p) => p.balanceSatang)).toEqual([4550, 13650]);
    const day = await paymentStatement(
      f.actors.SUPER_ADMIN,
      f.event.id,
      '2026-10-16',
      '2026-10-16',
    );
    expect(day).toMatchObject({
      openingSatang: 4550,
      receivedSatang: 9100,
      cashSatang: 0,
      promptPaySatang: 9100,
      closingSatang: 13650,
    });
    expect(day.rows[0].number).toBe(qr.number);
    expect(day.rows[0].customerName).toBe('Bank transfer customer');
    await expect(paymentStatement(f.actors.PAYMENT_CASHIER, f.event.id)).rejects.toThrow(
      'not authorized',
    );
    await expect(
      paymentStatement(f.actors.SUPER_ADMIN, f.event.id, '2026-10-17', '2026-10-16'),
    ).rejects.toThrow('Invalid date');
    const isolated = await salesFixture();
    expect(
      (await paymentStatement(isolated.actors.SUPER_ADMIN, isolated.event.id)).rows,
    ).toHaveLength(0);
    await controlAction(f.actors.SUPER_ADMIN, 'payment.void', {
      id: qr.id,
      key: randomUUID(),
      reason: 'Statement correction test',
    });
    expect((await paymentStatement(f.actors.SUPER_ADMIN, f.event.id)).receivedSatang).toBe(4550);
  });
});
