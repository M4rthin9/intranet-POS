import { z } from 'zod';
import QRCode from 'qrcode';
import { transaction } from './db';
import { audit, type Actor } from './audit';
import { AppError, requirePermission } from './rbac';
import { requireAssignedEvent } from './event-assignment';
import { receiptLayout } from './receipt-layout';
import { orderSlipQr } from './order-slip-qr';
import { sumMoney } from './money';

export async function printOrderSlip(actor: Actor, input: unknown) {
  requirePermission(actor.roleName, 'order.create');
  const data = z.object({ orderId: z.string().uuid(), eventId: z.string().uuid() }).parse(input);
  return transaction(async (tx) => {
    await requireAssignedEvent(tx, actor, data.eventId);
    const order = await tx.order.findFirst({
      where: {
        id: data.orderId,
        eventId: data.eventId,
        clearedSale: { is: null },
        ...(actor.roleName === 'SUPER_ADMIN' ? {} : { userId: actor.id }),
      },
      include: {
        items: { orderBy: { id: 'asc' } },
        event: true,
        station: true,
        user: { select: { displayName: true } },
        account: {
          include: {
            registration: true,
            credentials: { where: { revokedAt: null }, orderBy: { issuedAt: 'desc' }, take: 1 },
          },
        },
      },
    });
    if (!order) throw new AppError(404, 'Purchase record not found.');
    if (!['RECORDED', 'PAID'].includes(order.status))
      throw new AppError(409, 'Voided purchases cannot be printed.');
    if (!['ACTIVE', 'SETTLED'].includes(order.account.status))
      throw new AppError(409, 'Customer account is blocked or unavailable. Contact registration.');
    const credential = order.account.credentials[0];
    if (!credential) throw new AppError(409, 'Customer QR is revoked. Contact registration.');
    const outstandingOrders = await tx.order.findMany({
      where: {
        accountId: order.accountId,
        eventId: order.eventId,
        status: 'RECORDED',
        clearedSale: { is: null },
      },
      select: { totalSatang: true },
    });
    const outstandingSatang = sumMoney(outstandingOrders.map((purchase) => purchase.totalSatang));
    const layout = receiptLayout(
      (await tx.systemSetting.findUnique({ where: { key: 'receipt-layout' } }))?.value,
    );
    const printedBefore = await tx.auditLog.count({
      where: {
        entityType: 'Order',
        entityId: order.id,
        action: { in: ['ORDER_SLIP_PRINT', 'ORDER_SLIP_REPRINT'] },
      },
    });
    const qrImage = await QRCode.toDataURL(orderSlipQr(order.id, credential.token), {
      width: 480,
      margin: 4,
      errorCorrectionLevel: 'M',
    });
    await audit(
      tx,
      actor,
      printedBefore ? 'ORDER_SLIP_REPRINT' : 'ORDER_SLIP_PRINT',
      'Order',
      order.id,
      {
        eventId: order.eventId,
        stationId: order.stationId,
        after: { number: order.number, status: order.status, printCount: printedBefore + 1 },
      },
    );
    return {
      orderId: order.id,
      eventId: order.eventId,
      number: order.number,
      createdAt: order.createdAt.toISOString(),
      printedAt: new Date().toISOString(),
      eventName: order.event.name,
      eventCode: order.event.code,
      station: order.station.code,
      cashier: order.user.displayName,
      registrationNumber: order.account.registration.number,
      customerName: order.account.registration.customerName,
      status: order.status,
      totalSatang: order.totalSatang,
      outstandingSatang,
      items: order.items,
      qrImage,
      copy: printedBefore > 0,
      logoImage: layout.receiptLogo || null,
      header: layout.receiptHeader,
    };
  });
}
