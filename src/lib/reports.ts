import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { transaction, type Tx } from './db';
import { requirePermission, AppError } from './rbac';
import type { Actor } from './audit';
import { reportRange, paymentReportWhere } from './report-range';
import { requireAssignedEvent } from './event-assignment';
export type Metric = { label: string; amountSatang: number; quantity: number };
export type Outstanding = {
  id: string;
  registrationNumber: string;
  customerName: string;
  status: string;
  amountSatang: number;
  lastPurchase: string;
  orders: number;
};
export type Summary = {
  registered: number;
  active: number;
  settled: number;
  blocked: number;
  orders: number;
  grossSalesSatang: number;
  netSalesSatang: number;
  confirmedPayments: number;
  confirmedPaymentSatang: number;
  outstandingAccounts: number;
  outstandingSatang: number;
  voidOrders: number;
  voidOrderSatang: number;
  voidPayments: number;
  voidPaymentSatang: number;
  averageOrderSatang: number;
  reconciled: boolean;
  rangeFiltered: boolean;
  byHour: Metric[];
  byCategory: Metric[];
  byProduct: Metric[];
  byStation: Metric[];
  byCashier: Metric[];
  paymentTimeline: Metric[];
  outstandingTrend: Metric[];
  voidTrend: Metric[];
  outstanding: Outstanding[];
  asOf: string;
};
const numeric = (v: bigint | number | null) => {
  const n = Number(v ?? 0);
  if (!Number.isSafeInteger(n)) throw new Error('Unsafe financial aggregate.');
  return n;
};
export async function summarize(
  tx: Tx,
  eventId: string,
  from?: string,
  to?: string,
): Promise<Summary> {
  const { start, end, createdAt } = reportRange(from, to);
  if (!(await tx.event.findUnique({ where: { id: eventId }, select: { id: true } })))
    throw new AppError(404, 'Event not found.');
  const salesWhere = Prisma.sql`o."eventId"=${eventId} AND o."status" IN ('RECORDED','PAID') ${start ? Prisma.sql`AND o."createdAt">=${start}` : Prisma.empty} ${end ? Prisma.sql`AND o."createdAt"<${end}` : Prisma.empty}`;
  const paymentWhere = Prisma.sql`p."eventId"=${eventId} AND p."status"='CONFIRMED' ${start ? Prisma.sql`AND p."confirmedAt">=${start}` : Prisma.empty} ${end ? Prisma.sql`AND p."confirmedAt"<${end}` : Prisma.empty}`;
  const orderGroups = await tx.order.groupBy({
    by: ['status'],
    where: { eventId, createdAt, status: { not: 'DRAFT' } },
    _sum: { totalSatang: true },
    _count: true,
  });
  const accountGroups = await tx.customerAccount.groupBy({
    by: ['status'],
    where: { registration: { eventId } },
    _count: true,
  });
  const paymentGroups = await tx.payment.groupBy({
    by: ['status'],
    where: paymentReportWhere(eventId, createdAt),
    _sum: { amountSatang: true },
    _count: true,
  });
  const outstandingRows = await tx.$queryRaw<
    Array<{
      id: string;
      registrationNumber: string;
      customerName: string;
      status: string;
      amountSatang: bigint;
      lastPurchase: Date;
      orders: bigint;
    }>
  >`SELECT a."id",r."number" AS "registrationNumber",r."customerName",a."status"::text,SUM(o."totalSatang") AS "amountSatang",MAX(o."createdAt") AS "lastPurchase",COUNT(*) AS orders FROM "Order" o JOIN "CustomerAccount" a ON a."id"=o."accountId" JOIN "Registration" r ON r."id"=a."registrationId" WHERE o."eventId"=${eventId} AND o."status"='RECORDED' GROUP BY a."id",r."number",r."customerName",a."status" ORDER BY SUM(o."totalSatang") DESC`;
  const queryMetric = async (query: Prisma.Sql) => {
    const rows =
      await tx.$queryRaw<Array<{ label: string; amount: bigint; quantity: bigint }>>(query);
    return rows.map((r) => ({
      label: r.label,
      amountSatang: numeric(r.amount),
      quantity: numeric(r.quantity),
    }));
  };
  const byHour = await queryMetric(
    Prisma.sql`SELECT to_char(o."createdAt" AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD HH24:00') label,SUM(o."totalSatang") amount,COUNT(*) quantity FROM "Order" o WHERE ${salesWhere} GROUP BY label ORDER BY label`,
  );
  const byCategory = await queryMetric(
    Prisma.sql`SELECT i."categoryNameSnapshot" label,SUM(i."lineTotalSatang") amount,SUM(i."quantity") quantity FROM "OrderItem" i JOIN "Order" o ON o."id"=i."orderId" WHERE ${salesWhere} GROUP BY label ORDER BY amount DESC`,
  );
  const byProduct = await queryMetric(
    Prisma.sql`SELECT i."productCodeSnapshot"||' · '||i."productNameSnapshot" label,SUM(i."lineTotalSatang") amount,SUM(i."quantity") quantity FROM "OrderItem" i JOIN "Order" o ON o."id"=i."orderId" WHERE ${salesWhere} GROUP BY label ORDER BY amount DESC`,
  );
  const byStation = await queryMetric(
    Prisma.sql`SELECT s."code" label,SUM(o."totalSatang") amount,COUNT(*) quantity FROM "Order" o JOIN "Station" s ON s."id"=o."stationId" WHERE ${salesWhere} GROUP BY label ORDER BY amount DESC`,
  );
  const byCashier = await queryMetric(
    Prisma.sql`SELECT u."username"||' · '||u."displayName" label,SUM(o."totalSatang") amount,COUNT(*) quantity FROM "Order" o JOIN "User" u ON u."id"=o."userId" WHERE ${salesWhere} GROUP BY label ORDER BY amount DESC`,
  );
  const paymentTimeline = await queryMetric(
    Prisma.sql`SELECT to_char(p."confirmedAt" AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD HH24:00') label,SUM(p."amountSatang") amount,COUNT(*) quantity FROM "Payment" p WHERE ${paymentWhere} GROUP BY label ORDER BY label`,
  );
  const changes = await tx.$queryRaw<
    Array<{ label: string; delta: bigint; voidAmount: bigint; voidCount: bigint }>
  >`SELECT to_char("createdAt" AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD HH24:00') label,SUM(CASE WHEN action='ORDER_CREATE' THEN COALESCE(("after"->>'totalSatang')::bigint,0) WHEN action='ORDER_VOID' THEN -COALESCE(("before"->>'totalSatang')::bigint,0) WHEN action='PAYMENT_CONFIRM' THEN -COALESCE(("after"->>'amountSatang')::bigint,0) WHEN action IN ('PAYMENT_VOID','PAYMENT_REFUND') AND "before"->>'status'='CONFIRMED' THEN COALESCE(("before"->>'amountSatang')::bigint,0) ELSE 0 END) delta,SUM(CASE WHEN action='ORDER_VOID' THEN COALESCE(("before"->>'totalSatang')::bigint,0) WHEN action IN ('PAYMENT_VOID','PAYMENT_REFUND') THEN COALESCE(("before"->>'amountSatang')::bigint,0) ELSE 0 END) "voidAmount",COUNT(*) FILTER (WHERE action IN ('ORDER_VOID','PAYMENT_VOID','PAYMENT_REFUND')) "voidCount" FROM "AuditLog" WHERE "eventId"=${eventId} AND action IN ('ORDER_CREATE','ORDER_VOID','PAYMENT_CONFIRM','PAYMENT_VOID','PAYMENT_REFUND') GROUP BY label ORDER BY label`;
  let balance = 0;
  const inRange = (label: string) =>
    (!from || label.slice(0, 10) >= from) && (!to || label.slice(0, 10) <= to);
  const outstandingTrend = changes
    .map((r) => {
      balance += numeric(r.delta);
      return { label: r.label, amountSatang: balance, quantity: 0 };
    })
    .filter((row) => inRange(row.label));
  const voidTrend = changes
    .filter((r) => numeric(r.voidCount) > 0 && inRange(r.label))
    .map((r) => ({
      label: r.label,
      amountSatang: numeric(r.voidAmount),
      quantity: numeric(r.voidCount),
    }));
  const count = (status: string) => accountGroups.find((g) => g.status === status)?._count ?? 0;
  const os = (status: string) => orderGroups.find((g) => g.status === status);
  const ps = (status: string) => paymentGroups.find((g) => g.status === status);
  const outstanding = outstandingRows.map((r) => ({
    ...r,
    amountSatang: numeric(r.amountSatang),
    orders: numeric(r.orders),
    lastPurchase: r.lastPurchase.toISOString(),
  }));
  const outstandingSatang = outstanding.reduce((n, r) => n + r.amountSatang, 0);
  const netSalesSatang =
    numeric(os('RECORDED')?._sum.totalSatang ?? 0) + numeric(os('PAID')?._sum.totalSatang ?? 0);
  const grossSalesSatang = netSalesSatang + numeric(os('VOIDED')?._sum.totalSatang ?? 0);
  const confirmedPaymentSatang = numeric(ps('CONFIRMED')?._sum.amountSatang ?? 0);
  const orders = orderGroups.reduce((n, g) => n + g._count, 0);
  const voidOrders = os('VOIDED')?._count ?? 0;
  const rangeFiltered = !!(from || to);
  return {
    registered: accountGroups.reduce((n, g) => n + g._count, 0),
    active: count('ACTIVE'),
    settled: count('SETTLED'),
    blocked: count('BLOCKED'),
    orders,
    grossSalesSatang,
    netSalesSatang,
    confirmedPayments: ps('CONFIRMED')?._count ?? 0,
    confirmedPaymentSatang,
    outstandingAccounts: outstanding.length,
    outstandingSatang,
    voidOrders,
    voidOrderSatang: numeric(os('VOIDED')?._sum.totalSatang ?? 0),
    voidPayments: (ps('VOIDED')?._count ?? 0) + (ps('REFUNDED')?._count ?? 0),
    voidPaymentSatang:
      numeric(ps('VOIDED')?._sum.amountSatang ?? 0) +
      numeric(ps('REFUNDED')?._sum.amountSatang ?? 0),
    averageOrderSatang:
      orders > voidOrders ? Math.round(netSalesSatang / (orders - voidOrders)) : 0,
    reconciled: !rangeFiltered && netSalesSatang === confirmedPaymentSatang + outstandingSatang,
    rangeFiltered,
    byHour,
    byCategory,
    byProduct,
    byStation,
    byCashier,
    paymentTimeline,
    outstandingTrend,
    voidTrend,
    outstanding,
    asOf: new Date().toISOString(),
  };
}
export async function report(actor: Actor, eventId: string, from?: string, to?: string) {
  requirePermission(actor.roleName, 'report.view');
  z.string().uuid().parse(eventId);
  return transaction((tx) => summarize(tx, eventId, from, to));
}

const dashboardFields = [
  'registered',
  'active',
  'settled',
  'blocked',
  'orders',
  'grossSalesSatang',
  'netSalesSatang',
  'confirmedPayments',
  'confirmedPaymentSatang',
  'outstandingAccounts',
  'outstandingSatang',
  'voidOrders',
  'voidOrderSatang',
  'voidPayments',
  'voidPaymentSatang',
  'averageOrderSatang',
  'reconciled',
  'rangeFiltered',
  'byHour',
  'byCategory',
  'byProduct',
  'byCashier',
  'paymentTimeline',
  'outstandingTrend',
  'voidTrend',
  'asOf',
] as const;
export type DashboardSummary = Pick<Summary, (typeof dashboardFields)[number]>;
export async function dashboard(actor: Actor, eventId: string): Promise<DashboardSummary> {
  requirePermission(actor.roleName, 'dashboard.view');
  z.string().uuid().parse(eventId);
  const summary = await transaction(async (tx) => {
    await requireAssignedEvent(tx, actor, eventId);
    return summarize(tx, eventId);
  });
  // Expose aggregates, without the detailed customer debt list or station metadata.
  return Object.fromEntries(dashboardFields.map((key) => [key, summary[key]])) as DashboardSummary;
}
