import { z } from 'zod';
import { transaction } from './db';
import type { Actor } from './audit';
import { AppError, requirePermission } from './rbac';
import { summarize } from './reports';
import { sumMoney } from './money';

export async function eventFinancialReport(actor: Actor, eventId: string) {
  requirePermission(actor.roleName, 'report.view');
  z.string().uuid().parse(eventId);
  // One serializable snapshot prevents sales and payments changing between sections.
  return transaction(async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { code: true, name: true },
    });
    if (!event) throw new AppError(404, 'Event not found.');
    const summary = await summarize(tx, eventId);
    const payments = await tx.payment.groupBy({
      by: ['method'],
      where: { eventId, status: 'CONFIRMED', clearedSale: { is: null } },
      _sum: { amountSatang: true },
      _count: true,
    });
    const raw = await tx.$queryRaw<
      Array<{
        category: string;
        code: string;
        name: string;
        unitPriceSatang: number;
        quantity: bigint;
        amount: bigint;
      }>
    >`SELECT i."categoryNameSnapshot" AS category, i."productCodeSnapshot" AS code,
      i."productNameSnapshot" AS name, i."unitPriceSatang" AS "unitPriceSatang",
      SUM(i.quantity) AS quantity, SUM(i."lineTotalSatang") AS amount
      FROM "OrderItem" i JOIN "Order" o ON o.id=i."orderId"
      WHERE o."eventId"=${eventId} AND o.status IN ('RECORDED','PAID')
      AND NOT EXISTS (SELECT 1 FROM "ClearedOrder" c WHERE c."orderId"=o.id)
      GROUP BY i."categoryNameSnapshot",i."productCodeSnapshot",i."productNameSnapshot",i."unitPriceSatang"
      ORDER BY category,code,name,"unitPriceSatang"`;
    const products = raw.map(({ amount, quantity, ...row }) => {
      const count = Number(quantity);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Unsafe product quantity.');
      return { ...row, quantity: count, amountSatang: sumMoney([Number(amount)]) };
    });
    const categories = summary.byCategory;
    const methods = payments.map((p) => ({
      method: p.method,
      count: p._count,
      amountSatang: p._sum.amountSatang ?? 0,
    }));
    const receivedSatang = sumMoney(methods.map((p) => p.amountSatang));
    const categorySatang = sumMoney(categories.map((p) => p.amountSatang));
    const productSatang = sumMoney(products.map((p) => p.amountSatang));
    const salesSatang = summary.netSalesSatang;
    const checks = [
      {
        label: 'รวมช่องทางรับชำระ − ยอดรับชำระยืนยัน',
        differenceSatang: receivedSatang - summary.confirmedPaymentSatang,
      },
      { label: 'รวมหมวดหมู่ − ยอดขายสุทธิ', differenceSatang: categorySatang - salesSatang },
      { label: 'รวมสินค้าทุกรายการ − ยอดขายสุทธิ', differenceSatang: productSatang - salesSatang },
      {
        label: 'ยอดขายสุทธิ + เครดิตคงเหลือ − (รับชำระแล้ว + ยอดค้างชำระ)',
        differenceSatang:
          salesSatang +
          (summary.walletBalanceSatang ?? 0) -
          receivedSatang -
          summary.outstandingSatang,
      },
    ];
    return {
      event,
      asOf: summary.asOf,
      salesSatang,
      receivedSatang,
      walletBalanceSatang: summary.walletBalanceSatang ?? 0,
      outstandingSatang: summary.outstandingSatang,
      outstandingAccounts: summary.outstandingAccounts,
      grossSalesSatang: summary.grossSalesSatang,
      voidOrderSatang: summary.voidOrderSatang,
      voidOrders: summary.voidOrders,
      orders: summary.orders - summary.voidOrders,
      receipts: summary.confirmedPayments,
      quantity: products.reduce((n, p) => n + p.quantity, 0),
      methods,
      categories,
      products,
      categorySatang,
      productSatang,
      checks,
      reconciled: checks.every((check) => check.differenceSatang === 0),
    };
  });
}
export type EventFinancialReport = Awaited<ReturnType<typeof eventFinancialReport>>;
