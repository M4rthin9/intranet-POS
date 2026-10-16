import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { salesFixture } from './sales-helpers';
import { eventFinancialReport } from '../src/lib/event-financial-report';
import { orderAction } from '../src/lib/orders';
import { paymentAction } from '../src/lib/payments';
import { registrationAction } from '../src/lib/registration';
import { controlAction } from '../src/lib/controls';

afterAll(() => db.$disconnect());
describe('consolidated event financial report', () => {
  it('reconciles cash, PromptPay, unpaid sales and historical product prices without mixing events', async () => {
    const f = await salesFixture();
    await paymentAction(f.actors.SUPER_ADMIN, 'promptpay.save', {
      type: 'PHONE',
      identifier: '0812345678',
      displayName: 'TEST ONLY',
      enabled: true,
    });
    await orderAction(f.actors.CASHIER, 'order.create', f.orderInput(2));
    const cash = (await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
      eventId: f.event.id,
      stationId: f.stations[3].id,
      token: f.registration.token,
      key: randomUUID(),
      method: 'CASH',
    })) as { id: string };
    await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', {
      paymentId: cash.id,
      stationId: f.stations[3].id,
      key: randomUUID(),
      cashReceivedSatang: 10000,
      reference: `CASH-${randomUUID()}`,
      evidence: 'Cash counted',
      evidenceVerified: true,
    });
    const other = (await registrationAction(f.actors.ADMIN, 'registration.create', {
      eventId: f.event.id,
      stationId: f.stations[0].id,
      customerName: 'PromptPay customer',
    })) as { token: string };
    await orderAction(f.actors.CASHIER, 'order.create', { ...f.orderInput(), token: other.token });
    const qr = (await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
      eventId: f.event.id,
      stationId: f.stations[3].id,
      token: other.token,
      key: randomUUID(),
      method: 'PROMPTPAY',
    })) as { id: string };
    await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', {
      paymentId: qr.id,
      stationId: f.stations[3].id,
      key: randomUUID(),
      reference: randomUUID(),
      evidence: 'Bank checked',
      evidenceVerified: true,
    });
    const unpaid = (await registrationAction(f.actors.ADMIN, 'registration.create', {
      eventId: f.event.id,
      stationId: f.stations[0].id,
      customerName: 'Unpaid customer',
    })) as { token: string };
    await db.product.update({
      where: { id: f.product.id },
      data: { name: 'New tea name', priceSatang: 5000 },
    });
    await orderAction(f.actors.CASHIER, 'order.create', {
      ...f.orderInput(3),
      token: unpaid.token,
    });
    const report = await eventFinancialReport(f.actors.SUPER_ADMIN, f.event.id);
    expect(report).toMatchObject({
      salesSatang: 28650,
      receivedSatang: 13650,
      outstandingSatang: 15000,
      quantity: 6,
      categorySatang: 28650,
      productSatang: 28650,
      reconciled: true,
    });
    expect(report.methods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'CASH', amountSatang: 9100 }),
        expect.objectContaining({ method: 'PROMPTPAY', amountSatang: 4550 }),
      ]),
    );
    expect(report.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Thai Tea', unitPriceSatang: 4550, quantity: 3 }),
        expect.objectContaining({ name: 'New tea name', unitPriceSatang: 5000, quantity: 3 }),
      ]),
    );
    expect(report.checks.every((row) => row.differenceSatang === 0)).toBe(true);
    await controlAction(f.actors.SUPER_ADMIN, 'payment.void', {
      id: cash.id,
      key: randomUUID(),
      reason: 'Correction',
    });
    const corrected = await eventFinancialReport(f.actors.SUPER_ADMIN, f.event.id);
    expect(corrected).toMatchObject({
      receivedSatang: 4550,
      outstandingSatang: 24100,
      reconciled: true,
    });
    expect(corrected.methods.find((row) => row.method === 'CASH')).toBeUndefined();
    const isolated = await salesFixture();
    expect(
      await eventFinancialReport(isolated.actors.SUPER_ADMIN, isolated.event.id),
    ).toMatchObject({ salesSatang: 0, productSatang: 0, quantity: 0, reconciled: true });
    await expect(eventFinancialReport(f.actors.CASHIER, f.event.id)).rejects.toThrow(
      'not authorized',
    );
  });
  it('excludes voided orders from every sales subtotal and retains the void disclosure', async () => {
    const f = await salesFixture();
    await orderAction(f.actors.CASHIER, 'order.create', f.orderInput());
    const order = await db.order.findFirstOrThrow({ where: { eventId: f.event.id } });
    await controlAction(f.actors.SUPER_ADMIN, 'order.void', {
      id: order.id,
      key: randomUUID(),
      reason: 'Cancelled test sale',
    });
    const report = await eventFinancialReport(f.actors.SUPER_ADMIN, f.event.id);
    expect(report).toMatchObject({
      salesSatang: 0,
      categorySatang: 0,
      productSatang: 0,
      quantity: 0,
      voidOrderSatang: 4550,
      voidOrders: 1,
      reconciled: true,
    });
    expect(report.products).toEqual([]);
    expect(report.categories).toEqual([]);
  });
});
