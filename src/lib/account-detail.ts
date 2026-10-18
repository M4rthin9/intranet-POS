import type { Tx } from './db';
import type { resolveAccount } from './registration';
import { sumMoney } from './money';

export async function accountDetail(tx: Tx, account: Awaited<ReturnType<typeof resolveAccount>>) {
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
    outstandingSatang: sumMoney(
      orders.filter((order) => order.status === 'RECORDED').map((order) => order.totalSatang),
    ),
  };
}
