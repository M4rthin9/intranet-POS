import { z } from 'zod';
import { transaction } from './db';
import type { Actor } from './audit';
import { requirePermission, AppError } from './rbac';
import { reportRange } from './report-range';
import { sumMoney } from './money';

export async function paymentStatement(actor: Actor, eventId: string, from?: string, to?: string) {
  requirePermission(actor.roleName, 'report.view');
  z.string().uuid().parse(eventId);
  const { start, end } = reportRange(from, to);
  return transaction(async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { code: true, name: true },
    });
    if (!event) throw new AppError(404, 'Event not found.');
    const payments = await tx.payment.findMany({
      where: { eventId, status: 'CONFIRMED', clearedSale: { is: null } },
      include: {
        account: { select: { registration: { select: { number: true, customerName: true } } } },
        station: { select: { code: true } },
        user: { select: { displayName: true } },
      },
      orderBy: [{ confirmedAt: 'asc' }, { number: 'asc' }],
    });
    const before = payments.filter((p) => start && p.confirmedAt && p.confirmedAt < start);
    const selected = payments.filter(
      (p) => p.confirmedAt && (!start || p.confirmedAt >= start) && (!end || p.confirmedAt < end),
    );
    const openingSatang = sumMoney(before.map((p) => p.amountSatang));
    let balance = openingSatang;
    const rows = selected.map((p) => {
      balance = sumMoney([balance, p.amountSatang]);
      return {
        id: p.id,
        number: p.number,
        confirmedAt: p.confirmedAt!.toISOString(),
        method: p.method,
        reference: p.reference,
        amountSatang: p.amountSatang,
        balanceSatang: balance,
        registrationNumber: p.account.registration.number,
        customerName: p.account.registration.customerName,
        station: p.station.code,
        cashier: p.user.displayName,
      };
    });
    return {
      event,
      from: from ?? null,
      to: to ?? null,
      asOf: new Date().toISOString(),
      openingSatang,
      closingSatang: balance,
      receivedSatang: sumMoney(rows.map((p) => p.amountSatang)),
      promptPaySatang: sumMoney(
        rows.filter((p) => p.method === 'PROMPTPAY').map((p) => p.amountSatang),
      ),
      cashSatang: sumMoney(rows.filter((p) => p.method === 'CASH').map((p) => p.amountSatang)),
      rows,
    };
  });
}
export type PaymentStatement = Awaited<ReturnType<typeof paymentStatement>>;
