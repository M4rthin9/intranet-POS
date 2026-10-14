import { z } from 'zod';
import { transaction } from './db';
import { audit, type Actor } from './audit';
import { requirePermission, AppError } from './rbac';
import { resolveAccount } from './registration';
import { openEvent, station, shift, number } from './core';
import { idempotent } from './idempotency';
import { sumMoney } from './money';
export async function orderAction(actor: Actor, action: string, input: unknown) {
  if (action === 'account.lookup') {
    requirePermission(actor.roleName, 'account.lookup');
    const data = z
      .object({ eventId: z.string().uuid(), token: z.string().min(10).max(100) })
      .parse(input);
    return transaction(async (tx) => {
      const account = await resolveAccount(tx, data.eventId, data.token, true);
      const orders = await tx.order.findMany({
        where: { accountId: account.id },
        include: { items: true, station: { select: { code: true } } },
        orderBy: { createdAt: 'asc' },
      });
      const payments = await tx.payment.findMany({
        where: { accountId: account.id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          number: true,
          status: true,
          amountSatang: true,
          confirmedAt: true,
          createdAt: true,
        },
      });
      return {
        id: account.id,
        status: account.status,
        registrationNumber: account.registration.number,
        customerName: account.registration.customerName,
        orders,
        payments,
        outstandingSatang: sumMoney(
          orders.filter((o) => o.status === 'RECORDED').map((o) => o.totalSatang),
        ),
      };
    });
  }
  if (action === 'shift.open') {
    requirePermission(actor.roleName, 'shift.manage');
    const data = z
      .object({ eventId: z.string().uuid(), stationId: z.string().uuid() })
      .parse(input);
    return transaction(async (tx) => {
      await openEvent(tx, data.eventId);
      const expected =
        actor.roleName === 'ADMIN'
          ? 'REGISTRATION'
          : actor.roleName === 'PAYMENT_CASHIER'
            ? 'PAYMENT'
            : actor.roleName === 'CASHIER'
              ? 'POS'
              : 'ADMIN';
      const st = await tx.station.findUniqueOrThrow({ where: { id: data.stationId } });
      if (actor.roleName === 'SUPER_ADMIN') {
        if (!st.active) throw new AppError(409, 'Station is inactive.');
      } else await station(tx, st.id, expected);
      const existing = await tx.shift.findFirst({
        where: { OR: [{ userId: actor.id }, { stationId: data.stationId }], closedAt: null },
      });
      if (existing) {
        if (
          existing.userId === actor.id &&
          existing.eventId === data.eventId &&
          existing.stationId === data.stationId
        )
          return existing;
        throw new AppError(409, 'User or station already has an open shift.');
      }
      const value = await tx.shift.create({ data: { ...data, userId: actor.id } });
      await audit(tx, actor, 'SHIFT_OPEN', 'Shift', value.id, {
        eventId: data.eventId,
        stationId: data.stationId,
        after: value,
      });
      return value;
    });
  }
  requirePermission(actor.roleName, 'order.create');
  if (action !== 'order.create') throw new AppError(404, 'Unknown order operation.');
  const data = z
    .object({
      eventId: z.string().uuid(),
      stationId: z.string().uuid(),
      token: z.string().min(10).max(100),
      key: z.string().uuid(),
      expectedTotalSatang: z.number().int().positive().optional(),
      items: z
        .array(
          z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(99) }),
        )
        .min(1)
        .max(50),
    })
    .parse(input);
  return idempotent(actor, action, data.key, data, async (tx) => {
    await openEvent(tx, data.eventId);
    await station(tx, data.stationId, 'POS');
    const currentShift = await shift(tx, actor, data.eventId, data.stationId);
    const account = await resolveAccount(tx, data.eventId, data.token);
    if (
      await tx.payment.count({
        where: { accountId: account.id, status: { in: ['PENDING', 'AWAITING_CONFIRMATION'] } },
      })
    )
      throw new AppError(
        409,
        'Payment is in progress. New orders are locked until settlement or cancellation.',
      );
    const ids = data.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length)
      throw new AppError(400, 'Combine duplicate product lines.');
    const products = await tx.product.findMany({
      where: { id: { in: ids } },
      include: { category: true },
    });
    const items = [];
    for (const item of data.items) {
      const p = products.find((p) => p.id === item.productId);
      if (!p?.active || !p.category.active)
        throw new AppError(409, 'Product unavailable. Refresh the catalog.');
      items.push({
        productId: p.id,
        productCodeSnapshot: p.code,
        productNameSnapshot: p.name,
        categoryNameSnapshot: p.category.name,
        unitPriceSatang: p.priceSatang,
        quantity: item.quantity,
        lineTotalSatang: p.priceSatang * item.quantity,
      });
    }
    const totalSatang = sumMoney(items.map((i) => i.lineTotalSatang));
    if (data.expectedTotalSatang && data.expectedTotalSatang !== totalSatang)
      throw new AppError(
        409,
        'Product prices changed. Refresh and review the cart before retrying.',
      );
    const order = await tx.order.create({
      data: {
        number: await number(tx, 'ORD'),
        eventId: data.eventId,
        accountId: account.id,
        userId: actor.id,
        stationId: data.stationId,
        shiftId: currentShift.id,
        totalSatang,
        items: { create: items },
      },
      include: { items: true },
    });
    for (const item of items) {
      const p = products.find((p) => p.id === item.productId)!;
      if (p.trackStock) {
        const inventory = await tx.inventory.findUnique({
          where: { eventId_productId: { eventId: data.eventId, productId: p.id } },
        });
        if (!inventory || inventory.remainingStock < item.quantity)
          throw new AppError(409, `Insufficient stock: ${p.name}`);
        await tx.inventory.update({
          where: { id: inventory.id },
          data: {
            soldQuantity: { increment: item.quantity },
            remainingStock: { decrement: item.quantity },
          },
        });
        await tx.stockMovement.create({
          data: {
            inventoryId: inventory.id,
            quantity: -item.quantity,
            kind: 'SALE',
            reference: order.id,
            reason: 'Order recorded',
            actorUserId: actor.id,
          },
        });
      }
    }
    await audit(tx, actor, 'ORDER_CREATE', 'Order', order.id, {
      eventId: data.eventId,
      stationId: data.stationId,
      after: order,
    });
    return order;
  });
}
