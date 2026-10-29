import { closeShift } from './shift-ledger';
import { z } from 'zod';
import { transaction } from './db';
import { audit, type Actor } from './audit';
import { requirePermission, AppError } from './rbac';
import { summarize } from './reports';
export async function operationsAction(actor: Actor, action: string, input: unknown) {
  if (action === 'shift.close') {
    requirePermission(actor.roleName, 'shift.manage');
    const data = z
      .object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(500).optional() })
      .parse(input);
    return transaction(async (tx) => {
      return closeShift(tx, actor, data.id, data.reason);
    });
  }
  if (['stock.open', 'stock.adjust'].includes(action)) {
    requirePermission(actor.roleName, 'stock.manage');
    const data = z
      .object({
        eventId: z.string().uuid(),
        productId: z.string().uuid(),
        quantity: z.number().int().min(-1000000).max(1000000),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(input);
    return transaction(async (tx) => {
      const event = await tx.event.findUniqueOrThrow({ where: { id: data.eventId } });
      if (!['DRAFT', 'OPEN'].includes(event.status)) throw new AppError(409, 'Event is closed.');
      const product = await tx.product.findUniqueOrThrow({ where: { id: data.productId } });
      if (!product.trackStock)
        throw new AppError(409, 'Enable stock tracking for this product first.');
      let before = await tx.inventory.findUnique({
        where: { eventId_productId: { eventId: data.eventId, productId: data.productId } },
      });
      if (action === 'stock.open') {
        if (before)
          throw new AppError(409, 'Opening stock already exists. Use an adjustment with a reason.');
        if (data.quantity < 0) throw new AppError(400, 'Opening stock cannot be negative.');
        before = await tx.inventory.create({
          data: {
            eventId: data.eventId,
            productId: data.productId,
            openingStock: data.quantity,
            remainingStock: data.quantity,
          },
        });
        await tx.stockMovement.create({
          data: {
            inventoryId: before.id,
            quantity: data.quantity,
            kind: 'OPENING',
            reason: data.reason,
            actorUserId: actor.id,
          },
        });
        await audit(tx, actor, 'STOCK_OPEN', 'Inventory', before.id, {
          eventId: data.eventId,
          after: before,
          reason: data.reason,
        });
        return before;
      }
      if (!before) throw new AppError(409, 'Set opening stock first.');
      if (!data.quantity || before.remainingStock + data.quantity < 0)
        throw new AppError(409, 'Adjustment must be nonzero and cannot make stock negative.');
      const value = await tx.inventory.update({
        where: { id: before.id },
        data: {
          adjustments: { increment: data.quantity },
          remainingStock: { increment: data.quantity },
        },
      });
      await tx.stockMovement.create({
        data: {
          inventoryId: before.id,
          quantity: data.quantity,
          kind: 'ADJUSTMENT',
          reason: data.reason,
          actorUserId: actor.id,
        },
      });
      await audit(tx, actor, 'STOCK_ADJUST', 'Inventory', value.id, {
        eventId: data.eventId,
        before,
        after: value,
        reason: data.reason,
      });
      return value;
    });
  }
  if (action === 'event.close') {
    requirePermission(actor.roleName, 'event.manage');
    const data = z
      .object({
        eventId: z.string().uuid(),
        allowOutstanding: z.boolean().default(false),
        reason: z.string().trim().min(3).max(500).optional(),
      })
      .parse(input);
    return transaction(async (tx) => {
      const before = await tx.event.findUniqueOrThrow({ where: { id: data.eventId } });
      if (before.status !== 'OPEN') throw new AppError(409, 'Only an open event can be closed.');
      if (
        await tx.shift.count({
          where: { eventId: data.eventId, closedAt: null, user: { roleName: 'SUPER_ADMIN' } },
        })
      )
        throw new AppError(
          409,
          'Close all event shifts owned by Super Admin before closing the event.',
        );
      if (
        await tx.payment.count({
          where: { eventId: data.eventId, status: { in: ['PENDING', 'AWAITING_CONFIRMATION'] } },
        })
      )
        throw new AppError(409, 'Resolve all pending payments before closing the event.');
      const summary = await summarize(tx, data.eventId);
      if (!summary.reconciled)
        throw new AppError(409, 'Event totals do not reconcile. Investigate before closing.');
      if ((summary.walletBalanceSatang ?? 0) > 0)
        throw new AppError(
          409,
          'Unused prepaid credit remains. Keep the event open until credit is spent or refunded.',
        );
      if (summary.outstandingSatang > 0 && (!data.allowOutstanding || !data.reason))
        throw new AppError(
          409,
          'Outstanding balances remain. An explicit override and reason are required.',
        );
      const snapshot = {
        registered: summary.registered,
        orders: summary.orders,
        grossSalesSatang: summary.grossSalesSatang,
        netSalesSatang: summary.netSalesSatang,
        confirmedPayments: summary.confirmedPayments,
        confirmedPaymentSatang: summary.confirmedPaymentSatang,
        outstandingAccounts: summary.outstandingAccounts,
        outstandingSatang: summary.outstandingSatang,
        voidOrderSatang: summary.voidOrderSatang,
        voidPaymentSatang: summary.voidPaymentSatang,
        reconciled: summary.reconciled,
        closedAt: new Date().toISOString(),
        override: data.allowOutstanding,
      };
      for (const current of await tx.shift.findMany({
        where: { eventId: data.eventId, closedAt: null },
      }))
        await closeShift(
          tx,
          actor,
          current.id,
          'Automatic staff session reconciliation on event closing',
        );
      const value = await tx.event.update({
        where: { id: data.eventId },
        data: { status: 'CLOSED' },
      });
      await tx.systemSetting.create({
        data: { key: `event-close:${data.eventId}`, value: snapshot },
      });
      await tx.systemSetting.upsert({
        where: { key: `backup-request:${data.eventId}` },
        create: {
          key: `backup-request:${data.eventId}`,
          value: { status: 'PENDING', eventId: data.eventId, requestedBy: actor.id },
        },
        update: { value: { status: 'PENDING', eventId: data.eventId, requestedBy: actor.id } },
      });
      await audit(tx, actor, 'EVENT_CLOSE', 'Event', value.id, {
        eventId: value.id,
        before,
        after: snapshot,
        reason: data.reason,
      });
      return { event: value, summary: snapshot, backupRequested: true };
    });
  }
  if (action === 'event.archive') {
    requirePermission(actor.roleName, 'event.manage');
    const data = z
      .object({ eventId: z.string().uuid(), reason: z.string().trim().min(3).max(500) })
      .parse(input);
    return transaction(async (tx) => {
      const before = await tx.event.findUniqueOrThrow({ where: { id: data.eventId } });
      if (before.status !== 'CLOSED')
        throw new AppError(409, 'Only a closed event can be archived.');
      const value = await tx.event.update({
        where: { id: before.id },
        data: { status: 'ARCHIVED' },
      });
      await audit(tx, actor, 'EVENT_ARCHIVE', 'Event', value.id, {
        eventId: value.id,
        before,
        after: value,
        reason: data.reason,
      });
      return value;
    });
  }
  throw new AppError(404, 'Unknown operational action.');
}
