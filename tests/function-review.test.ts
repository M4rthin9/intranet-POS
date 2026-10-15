import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { salesFixture } from './sales-helpers';
import { paymentAction } from '../src/lib/payments';
import { orderAction } from '../src/lib/orders';
import { registrationAction } from '../src/lib/registration';
import { controlAction } from '../src/lib/controls';
import { report } from '../src/lib/reports';
import { reportRange, paymentReportWhere } from '../src/lib/report-range';
import { promptPayPayload } from '../src/lib/promptpay';
import { readData } from '../src/lib/data';
afterAll(() => db.$disconnect());

describe('function review regressions', () => {
  it('edits settled customer details without reopening, and filters trends and payment activity consistently', async () => {
    const f = await salesFixture();
    const existingUser = await db.user.findUniqueOrThrow({ where: { id: f.actors.CASHIER.id } });
    const searched = (await readData(
      f.actors.SUPER_ADMIN,
      'users',
      undefined,
      existingUser.username,
    )) as { id: string }[];
    expect(searched.map((row) => row.id)).toEqual([existingUser.id]);
    await expect(
      readData(f.actors.CASHIER, 'users', undefined, existingUser.username),
    ).rejects.toThrow('not authorized');
    await paymentAction(f.actors.SUPER_ADMIN, 'promptpay.save', {
      type: 'PHONE',
      identifier: '0812345678',
      displayName: 'TEST ONLY',
      enabled: true,
    });
    await orderAction(f.actors.CASHIER, 'order.create', f.orderInput());
    const recorded = await db.order.findFirstOrThrow({ where: { eventId: f.event.id } });
    expect(
      (
        (await readData(f.actors.SUPER_ADMIN, 'orders', f.event.id, recorded.number)) as {
          id: string;
        }[]
      ).map((row) => row.id),
    ).toEqual([recorded.id]);
    const open = await db.shift.findMany({ where: { eventId: f.event.id, closedAt: null } });
    await db.shift.createMany({
      data: Array.from({ length: 101 }, () => ({
        eventId: f.event.id,
        userId: f.actors.SUPER_ADMIN.id,
        stationId: f.stations[0].id,
        openedAt: new Date(),
        closedAt: new Date(),
        summary: {
          orders: 0,
          grossSalesSatang: 0,
          netSalesSatang: 0,
          voidOrders: 0,
          voidSatang: 0,
          payments: 0,
          confirmedPaymentSatang: 0,
          outstandingOrdersSatang: 0,
          outstandingImpactSatang: 0,
        },
      })),
    });
    const visible = (await readData(f.actors.SUPER_ADMIN, 'shifts', f.event.id)) as {
      id: string;
    }[];
    expect(visible.map((row) => row.id)).toEqual(expect.arrayContaining(open.map((row) => row.id)));
    // Simulate a payment generated on a previous Thai day without rewriting historical records.
    const shift = await db.shift.findFirstOrThrow({
      where: { userId: f.actors.PAYMENT_CASHIER.id, closedAt: null },
    });
    const generated = await db.payment.create({
      data: {
        number: `TEST-PAY-${randomUUID()}`,
        eventId: f.event.id,
        accountId: f.registration.account.id,
        userId: f.actors.PAYMENT_CASHIER.id,
        stationId: f.stations[3].id,
        shiftId: shift.id,
        amountSatang: 4550,
        qrPayload: promptPayPayload('PHONE', '0812345678', 4550),
        createdAt: new Date('2000-01-01T00:00:00Z'),
      },
    });
    await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', {
      paymentId: generated.id,
      stationId: f.stations[3].id,
      key: randomUUID(),
      reference: randomUUID(),
      evidence: 'TEST ONLY verification',
      evidenceVerified: true,
    });
    await registrationAction(f.actors.ADMIN, 'registration.update', {
      id: f.registration.id,
      customerName: 'Corrected settled customer',
      guestCount: 1,
      reason: 'Correct spelling',
    });
    expect(
      (await db.customerAccount.findUniqueOrThrow({ where: { id: f.registration.account.id } }))
        .status,
    ).toBe('SETTLED');
    await expect(
      registrationAction(f.actors.ADMIN, 'registration.update', {
        id: f.registration.id,
        customerName: 'Changed',
        status: 'ACTIVE',
        reason: 'Incorrect reopening',
      }),
    ).rejects.toThrow('reopen');
    await expect(
      registrationAction(f.actors.ADMIN, 'qr.block', {
        registrationId: f.registration.id,
        reason: '   ',
      }),
    ).rejects.toThrow();
    const payment = await db.payment.findUniqueOrThrow({ where: { id: generated.id } });
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(payment.confirmedAt!);
    const scope = reportRange(day, day);
    expect(await db.payment.count({ where: paymentReportWhere(f.event.id, scope.createdAt) })).toBe(
      1,
    );
    const old = await report(f.actors.SUPER_ADMIN, f.event.id, '2000-01-01', '2000-01-02');
    expect(old.outstandingTrend).toEqual([]);
    expect(old.voidTrend).toEqual([]);
    expect(
      await db.payment.count({
        where: paymentReportWhere(f.event.id, reportRange('2000-01-01', '2000-01-02').createdAt),
      }),
    ).toBe(0);
    await controlAction(f.actors.SUPER_ADMIN, 'payment.refund', {
      id: payment.id,
      key: randomUUID(),
      reason: 'Test refund reconciliation',
      refundVerified: true,
      refundReference: 'TEST-refund-reference',
    });
    const summary = await report(f.actors.SUPER_ADMIN, f.event.id, day, day);
    expect(summary.voidPaymentSatang).toBe(4550);
    expect(summary.voidTrend).toHaveLength(1);
    expect((await report(f.actors.SUPER_ADMIN, f.event.id)).reconciled).toBe(true);
    await expect(report(f.actors.SUPER_ADMIN, randomUUID())).rejects.toThrow('Event not found');
    expect(() => reportRange('2026-10-15', '2026-10-14')).toThrow('Invalid date range');
  });
});
