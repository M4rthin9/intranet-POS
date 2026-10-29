import { z } from 'zod';
import { transaction } from './db';
import { audit, type Actor } from './audit';
import { requirePermission, AppError } from './rbac';
import { openEvent } from './core';
import { idempotent } from './idempotency';
export async function controlAction(actor: Actor, action: string, input: unknown) {
  if (action === 'account.reopen') {
    requirePermission(actor.roleName, 'account.reopen');
    const data = z
      .object({ accountId: z.string().uuid(), reason: z.string().trim().min(3).max(500) })
      .parse(input);
    return transaction(async (tx) => {
      const before = await tx.customerAccount.findUniqueOrThrow({
        where: { id: data.accountId },
        include: { registration: true },
      });
      await openEvent(tx, before.registration.eventId);
      if (before.status !== 'SETTLED')
        throw new AppError(409, 'Only a settled account can be reopened here.');
      const value = await tx.customerAccount.update({
        where: { id: before.id },
        data: { status: 'ACTIVE' },
      });
      await audit(tx, actor, 'ACCOUNT_REOPEN', 'CustomerAccount', value.id, {
        eventId: before.registration.eventId,
        before: { status: before.status },
        after: { status: 'ACTIVE' },
        reason: data.reason,
      });
      return value;
    });
  }
  requirePermission(actor.roleName, action === 'order.void' ? 'order.void' : 'payment.void');
  const data = z
    .object({
      id: z.string().uuid(),
      key: z.string().uuid(),
      reason: z.string().trim().min(3).max(500),
      refundVerified: z.literal(true).optional(),
      refundReference: z.string().trim().min(3).max(120).optional(),
    })
    .parse(input);
  return idempotent(actor, action, data.key, data, async (tx) => {
    if (action === 'order.void') {
      const before = await tx.order.findUniqueOrThrow({
        where: { id: data.id },
        include: { items: true, account: true, allocations: { include: { payment: true } } },
      });
      await openEvent(tx, before.eventId);
      if (before.status === 'VOIDED') return before;
      const walletPurchase =
        before.status === 'PAID' &&
        before.allocations.length > 0 &&
        before.allocations.every((a) => a.payment.purpose === 'WALLET_TOPUP');
      if (before.status !== 'RECORDED' && !walletPurchase)
        throw new AppError(
          409,
          'Only an unpaid recorded order may be voided. Void its confirmed payment first.',
        );
      if (
        await tx.payment.count({
          where: {
            accountId: before.accountId,
            status: { in: ['PENDING', 'AWAITING_CONFIRMATION'] },
          },
        })
      )
        throw new AppError(409, 'Void the pending payment before changing its orders.');
      const value = await tx.order.update({
        where: { id: before.id },
        data: {
          status: 'VOIDED',
          voidReason: data.reason,
          voidedAt: new Date(),
          voidedBy: actor.id,
        },
      });
      if (walletPurchase)
        await tx.customerAccount.update({
          where: { id: before.accountId },
          data: { status: before.account.status },
        });
      const sales = await tx.stockMovement.findMany({
        where: { kind: 'SALE', reference: before.id },
      });
      for (const sale of sales) {
        const quantity = -sale.quantity;
        await tx.inventory.update({
          where: { id: sale.inventoryId },
          data: { soldQuantity: { decrement: quantity }, remainingStock: { increment: quantity } },
        });
        await tx.stockMovement.create({
          data: {
            inventoryId: sale.inventoryId,
            quantity,
            kind: 'VOID_RETURN',
            reference: before.id,
            reason: data.reason,
            actorUserId: actor.id,
          },
        });
      }
      await audit(tx, actor, 'ORDER_VOID', 'Order', value.id, {
        eventId: value.eventId,
        stationId: value.stationId,
        before,
        after: value,
        reason: data.reason,
      });
      return value;
    }
    if (!['payment.void', 'payment.refund'].includes(action))
      throw new AppError(404, 'Unknown control operation.');
    const before = await tx.payment.findUniqueOrThrow({
      where: { id: data.id },
      include: { allocations: true, account: true },
    });
    await openEvent(tx, before.eventId);
    if (['VOIDED', 'REFUNDED'].includes(before.status)) return before;
    if (
      action === 'payment.refund' &&
      (before.status !== 'CONFIRMED' || !data.refundVerified || !data.refundReference)
    )
      throw new AppError(
        400,
        'Recording a refund requires confirmed payment, verified refund and bank refund reference.',
      );
    if (!['PENDING', 'AWAITING_CONFIRMATION', 'CONFIRMED'].includes(before.status))
      throw new AppError(409, 'This payment cannot be voided.');
    if (
      before.purpose === 'WALLET_TOPUP' &&
      (await tx.order.count({
        where: { status: { not: 'VOIDED' }, allocations: { some: { paymentId: before.id } } },
      }))
    )
      throw new AppError(
        409,
        'Spent wallet credit cannot be voided or refunded. Void its purchases first.',
      );
    if (
      await tx.payment.count({
        where: {
          accountId: before.accountId,
          id: { not: before.id },
          status: { in: ['PENDING', 'AWAITING_CONFIRMATION'] },
        },
      })
    )
      throw new AppError(409, 'Resolve the newer pending payment before correcting this payment.');
    const value = await tx.payment.update({
      where: { id: before.id },
      data: {
        status: action === 'payment.refund' ? 'REFUNDED' : 'VOIDED',
        voidReason: data.reason,
        voidedAt: new Date(),
        voidedBy: actor.id,
      },
    });
    if (before.status === 'CONFIRMED') {
      await tx.order.updateMany({
        where: { id: { in: before.allocations.map((a) => a.orderId) }, status: 'PAID' },
        data: { status: 'RECORDED' },
      });
      await tx.customerAccount.update({
        where: { id: before.accountId },
        data: { status: before.account.status === 'BLOCKED' ? 'BLOCKED' : 'ACTIVE' },
      });
    }
    await audit(
      tx,
      actor,
      action === 'payment.refund' ? 'PAYMENT_REFUND' : 'PAYMENT_VOID',
      'Payment',
      value.id,
      {
        eventId: value.eventId,
        stationId: value.stationId,
        before: {
          status: before.status,
          amountSatang: before.amountSatang,
          allocations: before.allocations,
        },
        after: {
          status: value.status,
          restoredOrderIds: before.allocations.map((a) => a.orderId),
          refundReference: data.refundReference,
        },
        reason: data.reason,
      },
    );
    return value;
  });
}
