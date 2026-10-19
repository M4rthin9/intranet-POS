import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { orderAction } from '../src/lib/orders';
import { paymentAction } from '../src/lib/payments';
import { salesFixture } from './sales-helpers';

type PaymentResult = Awaited<ReturnType<typeof paymentAction>>;
type GeneratedPayment = Extract<PaymentResult, { qrPayload: string }>;
let originalSettings: Awaited<ReturnType<typeof db.promptPaySetting.findUnique>>;

beforeAll(async () => {
  originalSettings = await db.promptPaySetting.findUnique({ where: { id: 'primary' } });
  await db.promptPaySetting.upsert({
    where: { id: 'primary' },
    create: {
      id: 'primary',
      type: 'PHONE',
      identifier: '0812345678',
      displayName: 'Test recipient',
      enabled: true,
    },
    update: {
      type: 'PHONE',
      identifier: '0812345678',
      displayName: 'Test recipient',
      enabled: true,
    },
  });
});
afterAll(async () => {
  if (originalSettings)
    await db.promptPaySetting.update({ where: { id: 'primary' }, data: originalSettings });
  else await db.promptPaySetting.deleteMany({ where: { id: 'primary' } });
  await db.$disconnect();
});

async function pendingPromptPay() {
  const f = await salesFixture();
  await orderAction(f.actors.CASHIER, 'order.create', f.orderInput(2));
  const payment = (await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
    eventId: f.event.id,
    stationId: f.stations[3].id,
    token: f.registration.token,
    key: randomUUID(),
    method: 'PROMPTPAY',
  })) as GeneratedPayment;
  const adminStation = await db.station.create({
    data: { code: `ADMIN-${f.tag}`, name: 'Admin', type: 'ADMIN' },
  });
  await orderAction(f.actors.SUPER_ADMIN, 'shift.open', {
    eventId: f.event.id,
    stationId: adminStation.id,
  });
  const input = {
    eventId: f.event.id,
    stationId: adminStation.id,
    paymentId: payment.id,
    key: randomUUID(),
    reason: 'Customer paid cash during server outage; no bank transfer received',
  };
  return { ...f, payment, input };
}

describe('Super Admin changes pending PromptPay to cash', () => {
  it('denies every other role and requires a reason', async () => {
    const f = await pendingPromptPay();
    for (const role of ['ADMIN', 'CASHIER', 'PAYMENT_CASHIER', 'REGISTRATION_CASHIER'] as const)
      await expect(
        paymentAction(f.actors[role], 'payment.method.change', f.input),
      ).rejects.toMatchObject({ status: 403 });
    await expect(
      paymentAction(f.actors.SUPER_ADMIN, 'payment.method.change', { ...f.input, reason: ' ' }),
    ).rejects.toThrow();
    await expect(
      paymentAction(f.actors.SUPER_ADMIN, 'payment.method.change', {
        ...f.input,
        stationId: f.stations[3].id,
      }),
    ).rejects.toThrow('Open your shift');
    expect(await db.payment.findUniqueOrThrow({ where: { id: f.payment.id } })).toMatchObject({
      method: 'PROMPTPAY',
    });
  });

  it('replaces once, preserves the amount and original record, audits the reason, and confirms cash once', async () => {
    const f = await pendingPromptPay();
    await Promise.all([
      paymentAction(f.actors.SUPER_ADMIN, 'payment.method.change', f.input),
      paymentAction(f.actors.SUPER_ADMIN, 'payment.method.change', f.input),
    ]);
    const cash = (await paymentAction(
      f.actors.SUPER_ADMIN,
      'payment.method.change',
      f.input,
    )) as GeneratedPayment;
    expect(await db.payment.findUniqueOrThrow({ where: { id: f.payment.id } })).toMatchObject({
      id: f.payment.id,
      number: f.payment.number,
      amountSatang: 9100,
      method: 'PROMPTPAY',
      qrPayload: f.payment.qrPayload,
      status: 'VOIDED',
      voidReason: f.input.reason,
      voidedBy: f.actors.SUPER_ADMIN.id,
    });
    expect(cash).toMatchObject({
      method: 'CASH',
      amountSatang: 9100,
      qrPayload: '',
      recipientNameSnapshot: null,
    });
    expect(cash.id).not.toBe(f.payment.id);
    expect(await db.payment.count({ where: { accountId: f.registration.account.id } })).toBe(2);
    expect(await db.receipt.count({ where: { paymentId: cash.id } })).toBe(0);
    const logs = await db.auditLog.findMany({
      where: { entityId: cash.id, action: 'PAYMENT_METHOD_CHANGE' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      actorUserId: f.actors.SUPER_ADMIN.id,
      reason: f.input.reason,
      before: { paymentId: f.payment.id, method: 'PROMPTPAY', qrPayload: f.payment.qrPayload },
      after: { method: 'CASH', amountSatang: 9100 },
    });
    await expect(
      paymentAction(f.actors.PAYMENT_CASHIER, 'payment.qr.print', {
        paymentId: f.payment.id,
        stationId: f.stations[3].id,
      }),
    ).rejects.toThrow();
    const confirmation = {
      paymentId: cash.id,
      stationId: f.stations[3].id,
      key: randomUUID(),
      reference: `CASH-${randomUUID()}`,
      evidence: 'Cash collected during outage and counted',
      evidenceVerified: true,
    };
    await expect(
      paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', {
        ...confirmation,
        paymentId: f.payment.id,
      }),
    ).rejects.toThrow('not awaiting');
    await expect(
      paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', confirmation),
    ).rejects.toThrow('Cash received');
    await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', {
      ...confirmation,
      cashReceivedSatang: 10000,
    });
    await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', {
      ...confirmation,
      cashReceivedSatang: 10000,
    });
    expect(await db.receipt.count({ where: { paymentId: cash.id } })).toBe(1);
    expect(
      await db.customerAccount.findUniqueOrThrow({ where: { id: f.registration.account.id } }),
    ).toMatchObject({ status: 'SETTLED' });
    await expect(
      paymentAction(f.actors.SUPER_ADMIN, 'payment.method.change', {
        ...f.input,
        paymentId: cash.id,
        key: randomUUID(),
      }),
    ).rejects.toThrow('unpaid pending');
  });

  it('rejects mismatched events, blocked accounts, and closed events', async () => {
    const f = await pendingPromptPay();
    const change = (extra = {}) =>
      paymentAction(f.actors.SUPER_ADMIN, 'payment.method.change', {
        ...f.input,
        key: randomUUID(),
        ...extra,
      });
    await expect(change({ eventId: f.fixtureEvent.id })).rejects.toThrow('not found');
    await db.customerAccount.update({
      where: { id: f.registration.account.id },
      data: { status: 'BLOCKED' },
    });
    await expect(change()).rejects.toThrow('unpaid pending');
    await db.customerAccount.update({
      where: { id: f.registration.account.id },
      data: { status: 'ACTIVE' },
    });
    await db.event.update({ where: { id: f.event.id }, data: { status: 'CLOSED' } });
    await expect(change()).rejects.toThrow('not open');
    expect(await db.payment.findUniqueOrThrow({ where: { id: f.payment.id } })).toMatchObject({
      method: 'PROMPTPAY',
    });
  });
});
