import type { Tx } from './db';
import { audit, type Actor } from './audit';
import { requirePermission, AppError } from './rbac';
export async function closeShift(tx: Tx, actor: Actor, id: string, reason?: string) {
  const before = await tx.shift.findUniqueOrThrow({ where: { id: id } });
  if (before.userId !== actor.id) {
    requirePermission(actor.roleName, 'settings.manage');
    if (!reason) throw new AppError(400, 'A reason is required to close another user’s shift.');
  }
  if (before.closedAt) return before;
  if (
    await tx.payment.count({
      where: { shiftId: before.id, status: { in: ['PENDING', 'AWAITING_CONFIRMATION'] } },
    })
  )
    throw new AppError(409, 'Resolve pending payments before closing this shift.');
  const orders = await tx.order.groupBy({
    by: ['status'],
    where: { shiftId: before.id },
    _sum: { totalSatang: true },
    _count: true,
  });
  const payments = await tx.payment.groupBy({
    by: ['status'],
    where: { shiftId: before.id },
    _sum: { amountSatang: true },
    _count: true,
  });
  const grossSalesSatang = orders.reduce((n, g) => n + (g._sum.totalSatang ?? 0), 0);
  const voidSatang = orders.find((g) => g.status === 'VOIDED')?._sum.totalSatang ?? 0;
  const confirmedPaymentSatang =
    payments.find((g) => g.status === 'CONFIRMED')?._sum.amountSatang ?? 0;
  const outstandingOrdersSatang =
    orders.find((g) => g.status === 'RECORDED')?._sum.totalSatang ?? 0;
  const summary = {
    orders: orders.reduce((n, g) => n + g._count, 0),
    grossSalesSatang,
    netSalesSatang: grossSalesSatang - voidSatang,
    voidOrders: orders.find((g) => g.status === 'VOIDED')?._count ?? 0,
    voidSatang,
    payments: payments.reduce((n, g) => n + g._count, 0),
    confirmedPaymentSatang,
    outstandingOrdersSatang,
    outstandingImpactSatang: grossSalesSatang - voidSatang - confirmedPaymentSatang,
    openedAt: before.openedAt.toISOString(),
    closedAt: new Date().toISOString(),
  };
  const value = await tx.shift.update({
    where: { id: before.id },
    data: { closedAt: new Date(), summary },
  });
  await audit(tx, actor, 'SHIFT_CLOSE', 'Shift', value.id, {
    eventId: before.eventId,
    stationId: before.stationId,
    before,
    after: value,
    reason: reason,
  });
  return value;
}
