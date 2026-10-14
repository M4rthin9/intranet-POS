import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { salesFixture } from './sales-helpers';
import { catalogAction } from '../src/lib/catalog';
import { orderAction } from '../src/lib/orders';
import { controlAction } from '../src/lib/controls';
import { operationsAction } from '../src/lib/operations';
import { db } from '../src/lib/db';
afterAll(() => db.$disconnect());
async function stockFixture() {
  const f = await salesFixture();
  await catalogAction(f.actors.SUPER_ADMIN, 'product.save', {
    id: f.product.id,
    code: f.tag,
    name: 'Thai Tea',
    categoryId: f.category.id,
    priceBaht: '45.50',
    trackStock: true,
  });
  await operationsAction(f.actors.SUPER_ADMIN, 'stock.open', {
    eventId: f.event.id,
    productId: f.product.id,
    quantity: 5,
    reason: 'Opening count',
  });
  return f;
}
describe('shifts, stock and event closing', () => {
  it('decrements, restores and adjusts tracked stock without overwriting opening history', async () => {
    const f = await stockFixture();
    const order = (await orderAction(f.actors.CASHIER, 'order.create', f.orderInput(3))) as {
      id: string;
    };
    let inv = await db.inventory.findUniqueOrThrow({
      where: { eventId_productId: { eventId: f.event.id, productId: f.product.id } },
    });
    expect(inv.remainingStock).toBe(2);
    expect(inv.soldQuantity).toBe(3);
    await controlAction(f.actors.SUPER_ADMIN, 'order.void', {
      id: order.id,
      key: randomUUID(),
      reason: 'Incorrect selection',
    });
    await operationsAction(f.actors.SUPER_ADMIN, 'stock.adjust', {
      eventId: f.event.id,
      productId: f.product.id,
      quantity: 2,
      reason: 'Additional stock',
    });
    inv = await db.inventory.findUniqueOrThrow({ where: { id: inv.id } });
    expect(inv.remainingStock).toBe(7);
    expect(inv.soldQuantity).toBe(0);
    expect(inv.adjustments).toBe(2);
    expect(await db.stockMovement.count({ where: { inventoryId: inv.id } })).toBe(4);
    await expect(
      operationsAction(f.actors.SUPER_ADMIN, 'stock.open', {
        eventId: f.event.id,
        productId: f.product.id,
        quantity: 100,
        reason: 'Reset opening',
      }),
    ).rejects.toThrow('already exists');
    await expect(
      operationsAction(f.actors.SUPER_ADMIN, 'stock.adjust', {
        eventId: f.event.id,
        productId: f.product.id,
        quantity: -8,
        reason: 'Invalid reduction',
      }),
    ).rejects.toThrow('negative');
  });
  it('prevents concurrent overselling across stations', async () => {
    const f = await stockFixture();
    const results = await Promise.allSettled([
      orderAction(f.actors.CASHIER, 'order.create', f.orderInput(4)),
      orderAction(f.secondCashier, 'order.create', {
        ...f.orderInput(4),
        stationId: f.stations[2].id,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (
        await db.inventory.findUniqueOrThrow({
          where: { eventId_productId: { eventId: f.event.id, productId: f.product.id } },
        })
      ).remainingStock,
    ).toBe(1);
  });
  it('seals shift summaries, requires explicit closing override, archives and blocks closed-event checkout', async () => {
    const f = await salesFixture();
    await orderAction(f.actors.CASHIER, 'order.create', f.orderInput(2));
    await expect(
      operationsAction(f.actors.SUPER_ADMIN, 'event.close', {
        eventId: f.event.id,
        allowOutstanding: true,
        reason: 'Approved exception',
      }),
    ).rejects.toThrow('Close all event shifts');
    const shifts = await db.shift.findMany({ where: { eventId: f.event.id, closedAt: null } });
    for (const s of shifts)
      await operationsAction(
        s.userId === f.actors.CASHIER.id
          ? f.actors.CASHIER
          : s.userId === f.secondCashier.id
            ? f.secondCashier
            : f.actors.PAYMENT_CASHIER,
        'shift.close',
        { id: s.id },
      );
    const sealed = await db.shift.findFirstOrThrow({
      where: { eventId: f.event.id, userId: f.actors.CASHIER.id },
    });
    expect((sealed.summary as { grossSalesSatang: number }).grossSalesSatang).toBe(9100);
    await expect(
      db.shift.update({ where: { id: sealed.id }, data: { closedAt: null } }),
    ).rejects.toThrow('immutable');
    await expect(
      operationsAction(f.actors.SUPER_ADMIN, 'event.close', { eventId: f.event.id }),
    ).rejects.toThrow('Outstanding');
    await operationsAction(f.actors.SUPER_ADMIN, 'event.close', {
      eventId: f.event.id,
      allowOutstanding: true,
      reason: 'Authorized remaining receivable',
    });
    expect((await db.event.findUniqueOrThrow({ where: { id: f.event.id } })).status).toBe('CLOSED');
    expect(
      await db.systemSetting.findUnique({ where: { key: `event-close:${f.event.id}` } }),
    ).not.toBeNull();
    await expect(orderAction(f.actors.CASHIER, 'order.create', f.orderInput())).rejects.toThrow(
      'Event is not open',
    );
    await operationsAction(f.actors.SUPER_ADMIN, 'event.archive', {
      eventId: f.event.id,
      reason: 'Records archived',
    });
    expect((await db.event.findUniqueOrThrow({ where: { id: f.event.id } })).status).toBe(
      'ARCHIVED',
    );
    await expect(operationsAction(f.actors.ADMIN, 'event.close', {})).rejects.toThrow(
      'not authorized',
    );
  });
});
