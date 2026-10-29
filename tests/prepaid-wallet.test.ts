import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { Payment } from '@prisma/client';
import { db, transaction } from '../src/lib/db';
import { salesFixture } from './sales-helpers';
import { paymentAction } from '../src/lib/payments';
import { orderAction } from '../src/lib/orders';
import { registrationAction } from '../src/lib/registration';
import { controlAction } from '../src/lib/controls';
import { walletBalance } from '../src/lib/wallet';
import { summarize } from '../src/lib/reports';
import { eventFinancialReport } from '../src/lib/event-financial-report';
import { eventSalesAction } from '../src/lib/event-sales-clear';
import { operationsAction } from '../src/lib/operations';

afterAll(() => db.$disconnect());

async function prepaidFixture() {
  const f = await salesFixture();
  const eventInput = {
    id: f.event.id,
    code: `SALE-${f.tag}`,
    name: 'Prepaid event',
    status: 'OPEN',
    paymentMode: 'PREPAID',
  };
  await registrationAction(f.actors.SUPER_ADMIN, 'event.save', eventInput);
  const topupInput = (amountBaht = '100.00') => ({
    eventId: f.event.id,
    stationId: f.stations[3].id,
    token: f.registration.token,
    amountBaht,
    method: 'CASH',
    key: randomUUID(),
  });
  const confirmInput = (payment: Payment) => ({
    paymentId: payment.id,
    stationId: f.stations[3].id,
    key: randomUUID(),
    reference: `test-${randomUUID()}`,
    evidence: 'Cash counted by test cashier',
    evidenceVerified: true,
    cashReceivedSatang: payment.amountSatang,
  });
  const balance = () => transaction((tx) => walletBalance(tx, f.registration.account.id));
  async function topup(amountBaht = '100.00') {
    const payment = (await paymentAction(
      f.actors.PAYMENT_CASHIER,
      'payment.generate',
      topupInput(amountBaht),
    )) as unknown as Payment;
    await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', confirmInput(payment));
    return payment;
  }
  return { ...f, eventInput, topupInput, confirmInput, balance, topup };
}

describe('prepaid event wallets', () => {
  it('credits only verified money received, retries once, keeps the account active and issues a top-up receipt', async () => {
    const f = await prepaidFixture();
    const input = f.topupInput();
    const payment = (await paymentAction(
      f.actors.PAYMENT_CASHIER,
      'payment.generate',
      input,
    )) as unknown as Payment;
    expect(payment.purpose).toBe('WALLET_TOPUP');
    expect(await f.balance()).toBe(0);
    expect(
      ((await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', input)) as Payment).id,
    ).toBe(payment.id);
    await expect(
      paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', {
        ...f.confirmInput(payment),
        cashReceivedSatang: 9999,
      }),
    ).rejects.toThrow('Cash received');
    const confirmation = f.confirmInput(payment);
    const result = await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', confirmation);
    expect(await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', confirmation)).toEqual(
      JSON.parse(JSON.stringify(result)),
    );
    expect(await f.balance()).toBe(10000);
    expect(
      (await db.customerAccount.findUniqueOrThrow({ where: { id: f.registration.account.id } }))
        .status,
    ).toBe('ACTIVE');
    const receipt = await db.receipt.findUniqueOrThrow({ where: { paymentId: payment.id } });
    expect(receipt.snapshot).toMatchObject({
      purpose: 'WALLET_TOPUP',
      walletBalanceSatang: 10000,
      orders: [],
    });
    expect(
      await db.payment.count({ where: { accountId: payment.accountId, status: 'CONFIRMED' } }),
    ).toBe(1);
  });

  it('rejects unfunded spending, splits a purchase across top-ups and prevents concurrent overspending', async () => {
    const f = await prepaidFixture();
    await expect(orderAction(f.actors.CASHIER, 'order.create', f.orderInput())).rejects.toThrow(
      'Insufficient wallet credit',
    );
    await f.topup('30.00');
    await f.topup('30.00');
    const input = f.orderInput();
    const results = await Promise.allSettled([
      orderAction(f.actors.CASHIER, 'order.create', input),
      orderAction(f.secondCashier, 'order.create', {
        ...f.orderInput(),
        stationId: f.stations[2].id,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await f.balance()).toBe(1450);
    const orders = await db.order.findMany({
      where: { eventId: f.event.id },
      include: { allocations: true },
    });
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('PAID');
    expect(orders[0].allocations.map((a) => a.amountSatang).sort((a, b) => a - b)).toEqual([
      1550, 3000,
    ]);
    expect(await db.payment.count({ where: { eventId: f.event.id } })).toBe(2);
  });

  it('deducts a purchase once, restores credit on an audited void and refuses to refund spent funds', async () => {
    const f = await prepaidFixture();
    const payment = await f.topup();
    const input = f.orderInput();
    const order = (await orderAction(f.actors.CASHIER, 'order.create', input)) as { id: string };
    expect(
      ((await orderAction(f.actors.CASHIER, 'order.create', input)) as { id: string }).id,
    ).toBe(order.id);
    expect(await f.balance()).toBe(5450);
    await expect(
      controlAction(f.actors.SUPER_ADMIN, 'payment.refund', {
        id: payment.id,
        key: randomUUID(),
        reason: 'Verified refund',
        refundVerified: true,
        refundReference: 'test-refund',
      }),
    ).rejects.toThrow('Spent wallet credit');
    await expect(
      registrationAction(f.actors.ADMIN, 'registration.update', {
        id: f.registration.id,
        customerName: 'Customer',
        status: 'CANCELLED',
        reason: 'Cancel registration',
      }),
    ).rejects.toThrow('Unused wallet credit');
    await db.customerAccount.update({
      where: { id: f.registration.account.id },
      data: { status: 'BLOCKED' },
    });
    await controlAction(f.actors.SUPER_ADMIN, 'order.void', {
      id: order.id,
      key: randomUUID(),
      reason: 'Return purchase to wallet',
    });
    expect(await f.balance()).toBe(10000);
    expect(
      (await db.customerAccount.findUniqueOrThrow({ where: { id: f.registration.account.id } }))
        .status,
    ).toBe('BLOCKED');
    await controlAction(f.actors.SUPER_ADMIN, 'payment.refund', {
      id: payment.id,
      key: randomUUID(),
      reason: 'Verified unused credit refund',
      refundVerified: true,
      refundReference: 'test-refund',
    });
    expect(await f.balance()).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: order.id, action: 'ORDER_VOID' } })).toBe(
      1,
    );
  });

  it('reconciles received money with purchases plus unused credit and protects event lifecycle', async () => {
    const f = await prepaidFixture();
    await f.topup();
    await orderAction(f.actors.CASHIER, 'order.create', f.orderInput());
    const summary = await transaction((tx) => summarize(tx, f.event.id));
    expect(summary).toMatchObject({
      netSalesSatang: 4550,
      confirmedPaymentSatang: 10000,
      walletBalanceSatang: 5450,
      outstandingSatang: 0,
      reconciled: true,
    });
    const report = await eventFinancialReport(f.actors.SUPER_ADMIN, f.event.id);
    expect(report.reconciled).toBe(true);
    expect(report.checks.every((c) => c.differenceSatang === 0)).toBe(true);
    await expect(
      registrationAction(f.actors.SUPER_ADMIN, 'event.save', {
        ...f.eventInput,
        paymentMode: 'WALLET',
      }),
    ).rejects.toThrow('Payment mode cannot change');
    await expect(
      eventSalesAction(f.actors.SUPER_ADMIN, 'event.sales.preview', { eventId: f.event.id }),
    ).rejects.toThrow('Prepaid');
    await expect(
      operationsAction(f.actors.SUPER_ADMIN, 'event.close', { eventId: f.event.id }),
    ).rejects.toThrow('Unused prepaid credit');
  });

  it('requires the payment role, assigned event, active QR and a positive valid top-up amount', async () => {
    const f = await prepaidFixture();
    await expect(
      paymentAction(f.actors.CASHIER, 'payment.generate', f.topupInput()),
    ).rejects.toThrow('not authorized');
    for (const amount of ['0', '-1', '10.001', 'abc'])
      await expect(
        paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', f.topupInput(amount)),
      ).rejects.toThrow();
    await expect(
      paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
        ...f.topupInput(),
        eventId: f.fixtureEvent.id,
      }),
    ).rejects.toThrow();
    await db.qrCredential.updateMany({
      where: { accountId: f.registration.account.id },
      data: { revokedAt: new Date() },
    });
    await expect(
      paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', f.topupInput()),
    ).rejects.toThrow('QR');
    expect(await f.balance()).toBe(0);
  });

  it('enforces available funds in the database when the order handler is bypassed', async () => {
    const f = await prepaidFixture();
    const topup = await f.topup('50.00');
    const order = (await orderAction(f.actors.CASHIER, 'order.create', f.orderInput())) as {
      id: string;
    };
    const before = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true },
    });
    await expect(
      db.$transaction(async (tx) => {
        const invalid = await tx.order.create({
          data: {
            number: `INVALID-${randomUUID()}`,
            eventId: before.eventId,
            accountId: before.accountId,
            userId: before.userId,
            stationId: before.stationId,
            shiftId: before.shiftId,
            totalSatang: before.totalSatang,
            status: 'PAID',
            items: {
              create: before.items.map((item) => ({
                productId: item.productId,
                productCodeSnapshot: item.productCodeSnapshot,
                productNameSnapshot: item.productNameSnapshot,
                categoryNameSnapshot: item.categoryNameSnapshot,
                unitPriceSatang: item.unitPriceSatang,
                quantity: item.quantity,
                lineTotalSatang: item.lineTotalSatang,
              })),
            },
          },
        });
        await tx.paymentAllocation.create({
          data: { paymentId: topup.id, orderId: invalid.id, amountSatang: invalid.totalSatang },
        });
      }),
    ).rejects.toThrow();
    expect(await f.balance()).toBe(450);
    expect(await db.order.count({ where: { eventId: f.event.id } })).toBe(1);
  });

  it('resumes and prints pending PromptPay top-ups without crediting unverified transfers', async () => {
    const f = await prepaidFixture();
    await paymentAction(f.actors.SUPER_ADMIN, 'promptpay.save', {
      type: 'PHONE',
      identifier: '0812345678',
      displayName: 'Test recipient',
      enabled: true,
    });
    const payment = (await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
      ...f.topupInput(),
      method: 'PROMPTPAY',
    })) as unknown as Payment;
    const resumed = await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.resume', {
      eventId: f.event.id,
      stationId: f.stations[3].id,
      paymentId: payment.id,
    });
    expect(resumed).toMatchObject({ payment: { purpose: 'WALLET_TOPUP', amountSatang: 10000 } });
    expect(
      await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.qr.print', {
        paymentId: payment.id,
        stationId: f.stations[3].id,
      }),
    ).toHaveProperty('qrImage');
    expect(await f.balance()).toBe(0);
    await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', {
      ...f.confirmInput(payment),
      cashReceivedSatang: undefined,
    });
    expect(await f.balance()).toBe(10000);
  });
});
