import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { salesFixture } from './sales-helpers';
import { db, transaction } from '../src/lib/db';
import { eventSalesAction } from '../src/lib/event-sales-clear';
import { orderAction } from '../src/lib/orders';
import { paymentAction } from '../src/lib/payments';
import { controlAction } from '../src/lib/controls';
import { operationsAction } from '../src/lib/operations';
import { summarize } from '../src/lib/reports';
import { readData } from '../src/lib/data';
import * as backups from '../src/lib/backup';

afterAll(() => db.$disconnect());
async function preview(f: Awaited<ReturnType<typeof salesFixture>>) {
  return (await eventSalesAction(f.actors.SUPER_ADMIN, 'event.sales.preview', {
    eventId: f.event.id,
  })) as { event: { code: string }; token: string; summary: { orders: number } };
}
async function intent(f: Awaited<ReturnType<typeof salesFixture>>) {
  const p = await preview(f);
  return {
    eventId: f.event.id,
    eventCode: p.event.code,
    previewToken: p.token,
    key: randomUUID(),
    reason: 'Start a fresh event sales session',
    acknowledged: true,
  };
}
describe('clear event sales', () => {
  it('rechecks the preview after backup so sales arriving during backup are kept', async () => {
    const f = await salesFixture();
    await orderAction(f.actors.CASHIER, 'order.create', f.orderInput());
    const request = await intent(f);
    const createBackup = backups.createBackup;
    const spy = vi.spyOn(backups, 'createBackup').mockImplementationOnce(async (...args) => {
      const backup = await createBackup(...args);
      await orderAction(f.actors.CASHIER, 'order.create', f.orderInput());
      return backup;
    });
    try {
      await expect(
        eventSalesAction(f.actors.SUPER_ADMIN, 'event.sales.clear', request),
      ).rejects.toThrow('sales changed');
    } finally {
      spy.mockRestore();
    }
    expect(await db.eventSalesClear.count({ where: { eventId: f.event.id } })).toBe(0);
    expect((await transaction((tx) => summarize(tx, f.event.id))).netSalesSatang).toBe(9100);
  });
  it('backs up and resets all totals, restores stock exactly once, keeps customers and QR cards and supports new sales', async () => {
    const f = await salesFixture();
    await db.product.update({ where: { id: f.product.id }, data: { trackStock: true } });
    await operationsAction(f.actors.SUPER_ADMIN, 'stock.open', {
      eventId: f.event.id,
      productId: f.product.id,
      quantity: 20,
      reason: 'Opening stock',
    });
    await paymentAction(f.actors.SUPER_ADMIN, 'promptpay.save', {
      type: 'PHONE',
      identifier: '0812345678',
      displayName: 'TEST ONLY',
      enabled: true,
    });
    const paid = (await orderAction(f.actors.CASHIER, 'order.create', f.orderInput(2))) as {
      id: string;
    };
    const payment = (await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
      eventId: f.event.id,
      stationId: f.stations[3].id,
      token: f.registration.token,
      key: randomUUID(),
    })) as { id: string };
    await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', {
      paymentId: payment.id,
      stationId: f.stations[3].id,
      key: randomUUID(),
      reference: randomUUID(),
      evidence: 'Verified test transfer',
      evidenceVerified: true,
    });
    expect(
      (await db.customerAccount.findUniqueOrThrow({ where: { id: f.registration.account.id } }))
        .status,
    ).toBe('SETTLED');
    await controlAction(f.actors.SUPER_ADMIN, 'account.reopen', {
      accountId: f.registration.account.id,
      reason: 'Additional purchase',
    });
    const voided = (await orderAction(f.actors.CASHIER, 'order.create', f.orderInput())) as {
      id: string;
    };
    await controlAction(f.actors.SUPER_ADMIN, 'order.void', {
      id: voided.id,
      key: randomUUID(),
      reason: 'Wrong selection',
    });
    await orderAction(f.actors.CASHIER, 'order.create', f.orderInput(3));
    await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
      eventId: f.event.id,
      stationId: f.stations[3].id,
      token: f.registration.token,
      key: randomUUID(),
    });
    await db.customerAccount.update({
      where: { id: f.registration.account.id },
      data: { status: 'SETTLED' },
    });
    await db.registration.update({ where: { id: f.registration.id }, data: { isVip: true } });
    const original = await db.registration.findUniqueOrThrow({
      where: { id: f.registration.id },
      include: { account: { include: { credentials: true } } },
    });
    const other = await salesFixture();
    await orderAction(other.actors.CASHIER, 'order.create', other.orderInput());
    const request = await intent(f);
    const results = await Promise.all([
      eventSalesAction(f.actors.SUPER_ADMIN, 'event.sales.clear', request),
      eventSalesAction(f.actors.SUPER_ADMIN, 'event.sales.clear', request),
    ]);
    expect(results[0]).toEqual(results[1]);
    const result = results[0] as { clearId: string; backupId: string };
    const totals = await transaction((tx) => summarize(tx, f.event.id));
    expect(totals).toMatchObject({
      registered: 1,
      active: 1,
      settled: 0,
      orders: 0,
      grossSalesSatang: 0,
      netSalesSatang: 0,
      confirmedPayments: 0,
      confirmedPaymentSatang: 0,
      outstandingSatang: 0,
      voidOrders: 0,
      voidPayments: 0,
      voidOrderSatang: 0,
      voidPaymentSatang: 0,
      reconciled: true,
      byHour: [],
      paymentTimeline: [],
      outstandingTrend: [],
      voidTrend: [],
    });
    expect(await readData(f.actors.SUPER_ADMIN, 'orders', f.event.id)).toEqual([]);
    expect(await readData(f.actors.SUPER_ADMIN, 'payments', f.event.id)).toEqual([]);
    expect(
      await db.inventory.findUniqueOrThrow({
        where: { eventId_productId: { eventId: f.event.id, productId: f.product.id } },
      }),
    ).toMatchObject({ openingStock: 20, soldQuantity: 0, remainingStock: 20 });
    const kept = await db.registration.findUniqueOrThrow({
      where: { id: f.registration.id },
      include: { account: { include: { credentials: true } } },
    });
    expect(kept.account?.credentials).toEqual(original.account?.credentials);
    expect(kept.customerName).toBe(original.customerName);
    expect(kept.isVip).toBe(true);
    expect(await db.order.count({ where: { eventId: f.event.id } })).toBe(3);
    expect(await db.clearedOrder.count({ where: { clearId: result.clearId } })).toBe(3);
    expect(await db.clearedPayment.count({ where: { clearId: result.clearId } })).toBe(2);
    expect(await db.receipt.count({ where: { paymentId: payment.id } })).toBe(1);
    expect(
      await db.paymentAllocation.count({ where: { paymentId: payment.id, orderId: paid.id } }),
    ).toBe(1);
    expect(
      await db.systemSetting.findUnique({ where: { key: `backup:${result.backupId}` } }),
    ).toBeTruthy();
    expect(await db.shift.count({ where: { eventId: f.event.id, closedAt: null } })).toBe(0);
    expect((await transaction((tx) => summarize(tx, other.event.id))).netSalesSatang).toBe(4550);
    await expect(db.clearedOrder.delete({ where: { orderId: paid.id } })).rejects.toThrow(
      'append-only',
    );
    await expect(
      db.eventSalesClear.update({ where: { id: result.clearId }, data: { reason: 'tamper' } }),
    ).rejects.toThrow('append-only');
    await expect(
      eventSalesAction(f.actors.SUPER_ADMIN, 'event.sales.clear', {
        ...request,
        reason: 'Different data',
      }),
    ).rejects.toThrow('different data');
    await orderAction(f.actors.CASHIER, 'order.create', f.orderInput());
    expect(await transaction((tx) => summarize(tx, f.event.id))).toMatchObject({
      orders: 1,
      netSalesSatang: 4550,
      grossSalesSatang: 4550,
      outstandingSatang: 4550,
      voidOrders: 0,
    });
    // An old retry cannot erase a new sale or return stock twice.
    expect(await eventSalesAction(f.actors.SUPER_ADMIN, 'event.sales.clear', request)).toEqual(
      result,
    );
    expect((await transaction((tx) => summarize(tx, f.event.id))).netSalesSatang).toBe(4550);
  });
  it('rejects unauthorized, unconfirmed, stale, empty and closed-event requests before clearing', async () => {
    const f = await salesFixture();
    for (const role of ['ADMIN', 'CASHIER', 'PAYMENT_CASHIER', 'REGISTRATION_CASHIER'] as const) {
      for (const action of ['event.sales.preview', 'event.sales.clear'])
        await expect(eventSalesAction(f.actors[role], action, {})).rejects.toThrow(
          'not authorized',
        );
    }
    await expect(
      eventSalesAction(f.actors.SUPER_ADMIN, 'event.sales.clear', await intent(f)),
    ).rejects.toThrow('no sales');
    await orderAction(f.actors.CASHIER, 'order.create', f.orderInput());
    const request = await intent(f);
    await expect(
      eventSalesAction(f.actors.SUPER_ADMIN, 'event.sales.clear', {
        ...request,
        eventCode: 'wrong',
      }),
    ).rejects.toThrow('exact event code');
    await expect(
      eventSalesAction(f.actors.SUPER_ADMIN, 'event.sales.clear', { ...request, reason: ' ' }),
    ).rejects.toThrow();
    await expect(
      eventSalesAction(f.actors.SUPER_ADMIN, 'event.sales.clear', {
        ...request,
        acknowledged: false,
      }),
    ).rejects.toThrow();
    await orderAction(f.actors.CASHIER, 'order.create', f.orderInput());
    await expect(
      eventSalesAction(f.actors.SUPER_ADMIN, 'event.sales.clear', request),
    ).rejects.toThrow('sales changed');
    expect(await db.eventSalesClear.count({ where: { eventId: f.event.id } })).toBe(0);
    await db.event.update({ where: { id: f.event.id }, data: { status: 'CLOSED' } });
    await expect(preview(f)).rejects.toThrow('Only an open event');
  });
  it('does not mutate sales or blocked accounts when backup fails', async () => {
    const f = await salesFixture();
    const order = (await orderAction(f.actors.CASHIER, 'order.create', f.orderInput())) as {
      id: string;
    };
    await db.customerAccount.update({
      where: { id: f.registration.account.id },
      data: { status: 'BLOCKED' },
    });
    const request = await intent(f);
    const directory = process.env.PG_BIN_DIRECTORY;
    process.env.PG_BIN_DIRECTORY = '/does-not-exist';
    try {
      await expect(
        eventSalesAction(f.actors.SUPER_ADMIN, 'event.sales.clear', request),
      ).rejects.toThrow('unavailable');
    } finally {
      if (directory === undefined) delete process.env.PG_BIN_DIRECTORY;
      else process.env.PG_BIN_DIRECTORY = directory;
    }
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('RECORDED');
    expect(await db.clearedOrder.count({ where: { orderId: order.id } })).toBe(0);
    await eventSalesAction(f.actors.SUPER_ADMIN, 'event.sales.clear', request);
    expect(
      (await db.customerAccount.findUniqueOrThrow({ where: { id: f.registration.account.id } }))
        .status,
    ).toBe('BLOCKED');
  });
});
