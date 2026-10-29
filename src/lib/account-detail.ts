import type { Tx } from './db';
import type { resolveAccount } from './registration';
import { sumMoney } from './money';
import { walletBalance } from './wallet';

export async function accountDetail(tx: Tx, account: Awaited<ReturnType<typeof resolveAccount>>) {
  const event = await tx.event.findUniqueOrThrow({
    where: { id: account.registration.eventId },
    select: { paymentMode: true },
  });
  const orders = await tx.order.findMany({
    where: { accountId: account.id, clearedSale: { is: null } },
    include: { items: true, station: { select: { code: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const payments = await tx.payment.findMany({
    where: { accountId: account.id, clearedSale: { is: null } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      number: true,
      status: true,
      amountSatang: true,
      purpose: true,
      confirmedAt: true,
      createdAt: true,
    },
  });
  return {
    id: account.id,
    status: account.status,
    registrationNumber: account.registration.number,
    customerName: account.registration.customerName,
    isVip: account.registration.isVip,
    scannedOrder: account.scannedOrder,
    orders,
    payments,
    ...(event.paymentMode === 'PREPAID'
      ? { walletBalanceSatang: await walletBalance(tx, account.id) }
      : {}),
    outstandingSatang: sumMoney(
      orders.filter((order) => order.status === 'RECORDED').map((order) => order.totalSatang),
    ),
  };
}
