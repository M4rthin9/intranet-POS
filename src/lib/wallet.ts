import type { Tx } from './db';
import { sumMoney } from './money';

// Credit comes only from confirmed money received, less purchases not subsequently voided.
export async function walletFunds(tx: Tx, accountId: string) {
  const payments = await tx.payment.findMany({
    where: { accountId, purpose: 'WALLET_TOPUP', status: 'CONFIRMED', clearedSale: { is: null } },
    include: { allocations: { include: { order: { select: { status: true } } } } },
    orderBy: [{ confirmedAt: 'asc' }, { id: 'asc' }],
  });
  return payments.map((payment) => ({
    id: payment.id,
    remainingSatang:
      payment.amountSatang -
      sumMoney(
        payment.allocations.filter((a) => a.order.status !== 'VOIDED').map((a) => a.amountSatang),
      ),
  }));
}

export async function walletBalance(tx: Tx, accountId: string) {
  return sumMoney((await walletFunds(tx, accountId)).map((p) => p.remainingSatang));
}
