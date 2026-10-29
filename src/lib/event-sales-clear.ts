import { createHash } from 'node:crypto';
import { z } from 'zod';
import { transaction, type Tx } from './db';
import { audit, type Actor } from './audit';
import { AppError, requirePermission } from './rbac';
import { backupFile, createBackup, runPg } from './backup';
import { idempotent, idempotencyReplay } from './idempotency';
import { closeShift } from './shift-ledger';

async function snapshot(tx: Tx, eventId: string) {
  const event = await tx.event.findUnique({ where: { id: eventId } });
  if (!event) throw new AppError(404, 'Event not found.');
  if (event.status !== 'OPEN')
    throw new AppError(409, 'Only an open event can have sales cleared.');
  if (event.paymentMode === 'PREPAID')
    throw new AppError(
      409,
      'Prepaid event sales cannot be cleared. Correct individual purchases and top-ups instead.',
    );
  const orders = await tx.order.findMany({
    where: { eventId, clearedSale: { is: null } },
    orderBy: { id: 'asc' },
  });
  const payments = await tx.payment.findMany({
    where: { eventId, clearedSale: { is: null } },
    orderBy: { id: 'asc' },
  });
  const summary = {
    orders: orders.length,
    payments: payments.length,
    netSalesSatang: orders
      .filter((o) => ['RECORDED', 'PAID'].includes(o.status))
      .reduce((n, o) => n + o.totalSatang, 0),
    outstandingSatang: orders
      .filter((o) => o.status === 'RECORDED')
      .reduce((n, o) => n + o.totalSatang, 0),
    confirmedPaymentSatang: payments
      .filter((p) => p.status === 'CONFIRMED')
      .reduce((n, p) => n + p.amountSatang, 0),
  };
  const token = createHash('sha256')
    .update(JSON.stringify({ event, orders, payments }))
    .digest('hex');
  return { event, orders, payments, summary, token };
}

export async function eventSalesAction(actor: Actor, action: string, input: unknown) {
  requirePermission(actor.roleName, 'settings.manage');
  if (!['event.sales.preview', 'event.sales.clear'].includes(action))
    throw new AppError(404, 'Unknown event sales operation.');
  if (action === 'event.sales.preview') {
    const data = z.object({ eventId: z.string().uuid() }).parse(input);
    return transaction(async (tx) => {
      const { event, summary, token } = await snapshot(tx, data.eventId);
      const history = await tx.eventSalesClear.findMany({
        where: { eventId: event.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      return { event, summary, token, history };
    });
  }
  const data = z
    .object({
      eventId: z.string().uuid(),
      eventCode: z.string(),
      reason: z.string().trim().min(3).max(500),
      key: z.string().uuid(),
      previewToken: z.string().regex(/^[a-f0-9]{64}$/),
      acknowledged: z.literal(true),
    })
    .parse(input);
  const replay = await idempotencyReplay(actor, action, data.key, data);
  if (replay) return replay.response;
  const validate = async (tx: Tx) => {
    const current = await snapshot(tx, data.eventId);
    if (current.event.code !== data.eventCode)
      throw new AppError(400, 'Enter the exact event code to confirm.');
    if (current.token !== data.previewToken)
      throw new AppError(409, 'Event sales changed. Refresh the preview before clearing.');
    if (!current.orders.length && !current.payments.length)
      throw new AppError(409, 'There are no sales to clear.');
    return current;
  };
  await transaction(validate);
  const backup = await createBackup(
    actor,
    `Before clearing event sales: ${data.reason}`,
    data.eventId,
  );
  await runPg('pg_restore', ['--list', backupFile(backup.name)], process.env.DATABASE_URL!);
  return idempotent(actor, action, data.key, data, async (tx) => {
    const current = await validate(tx);
    // Writing the event makes concurrent sales and event closing conflict under Serializable isolation.
    await tx.event.update({ where: { id: data.eventId }, data: { updatedAt: new Date() } });
    const clear = await tx.eventSalesClear.create({
      data: {
        eventId: data.eventId,
        actorUserId: actor.id,
        reason: data.reason,
        backupId: backup.id,
        summary: current.summary,
      },
    });
    const orders = current.orders.filter((o) => o.status !== 'VOIDED');
    const payments = current.payments.filter((p) =>
      ['PENDING', 'AWAITING_CONFIRMATION', 'CONFIRMED'].includes(p.status),
    );
    const correction = {
      status: 'VOIDED' as const,
      voidReason: data.reason,
      voidedAt: new Date(),
      voidedBy: actor.id,
    };
    await tx.payment.updateMany({
      where: { id: { in: payments.map((p) => p.id) } },
      data: correction,
    });
    await tx.order.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: correction });
    const corrections = [
      ...orders.map((o) => ({
        id: o.id,
        stationId: o.stationId,
        status: o.status,
        amount: o.totalSatang,
        entityType: 'Order',
        action: 'ORDER_VOID',
      })),
      ...payments.map((p) => ({
        id: p.id,
        stationId: p.stationId,
        status: p.status,
        amount: p.amountSatang,
        entityType: 'Payment',
        action: 'PAYMENT_VOID',
      })),
    ];
    if (corrections.length)
      await tx.auditLog.createMany({
        data: corrections.map((c) => ({
          actorUserId: actor.id,
          actorRole: actor.roleName,
          eventId: data.eventId,
          stationId: c.stationId,
          action: c.action,
          entityType: c.entityType,
          entityId: c.id,
          reason: data.reason,
          before: {
            status: c.status,
            ...(c.entityType === 'Order' ? { totalSatang: c.amount } : { amountSatang: c.amount }),
          },
          after: { status: 'VOIDED', clearId: clear.id },
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        })),
      });
    const sales = await tx.stockMovement.findMany({
      where: {
        kind: 'SALE',
        reference: { in: orders.map((o) => o.id) },
        inventory: { eventId: data.eventId },
      },
    });
    const returns = new Map<string, number>();
    for (const sale of sales)
      returns.set(sale.inventoryId, (returns.get(sale.inventoryId) ?? 0) - sale.quantity);
    for (const [id, quantity] of returns)
      await tx.inventory.update({
        where: { id },
        data: { soldQuantity: { decrement: quantity }, remainingStock: { increment: quantity } },
      });
    if (sales.length)
      await tx.stockMovement.createMany({
        data: sales.map((s) => ({
          inventoryId: s.inventoryId,
          quantity: -s.quantity,
          kind: 'VOID_RETURN',
          reference: s.reference,
          reason: data.reason,
          actorUserId: actor.id,
        })),
      });
    const settledAccounts = await tx.customerAccount.findMany({
      where: { registration: { eventId: data.eventId }, status: 'SETTLED' },
      select: { id: true },
    });
    await tx.customerAccount.updateMany({
      where: { registration: { eventId: data.eventId }, status: 'SETTLED' },
      data: { status: 'ACTIVE' },
    });
    if (settledAccounts.length)
      await tx.auditLog.createMany({
        data: settledAccounts.map((account) => ({
          actorUserId: actor.id,
          actorRole: actor.roleName,
          eventId: data.eventId,
          action: 'ACCOUNT_REOPEN',
          entityType: 'CustomerAccount',
          entityId: account.id,
          before: { status: 'SETTLED' },
          after: { status: 'ACTIVE', clearId: clear.id },
          reason: data.reason,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        })),
      });
    for (const shift of await tx.shift.findMany({
      where: { eventId: data.eventId, closedAt: null },
    }))
      await closeShift(tx, actor, shift.id, `Event sales cleared: ${data.reason}`);
    if (current.orders.length)
      await tx.clearedOrder.createMany({
        data: current.orders.map((o) => ({ orderId: o.id, clearId: clear.id })),
      });
    if (current.payments.length)
      await tx.clearedPayment.createMany({
        data: current.payments.map((p) => ({ paymentId: p.id, clearId: clear.id })),
      });
    await audit(tx, actor, 'EVENT_SALES_CLEAR', 'Event', data.eventId, {
      eventId: data.eventId,
      before: current.summary,
      after: {
        clearId: clear.id,
        backupId: backup.id,
        orders: 0,
        payments: 0,
        outstandingSatang: 0,
      },
      reason: data.reason,
    });
    return { clearId: clear.id, backupId: backup.id, summary: current.summary };
  });
}
