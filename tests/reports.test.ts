import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { salesFixture } from './sales-helpers';
import { orderAction } from '../src/lib/orders';
import { paymentAction } from '../src/lib/payments';
import { controlAction } from '../src/lib/controls';
import { report } from '../src/lib/reports';
import { csvCell } from '../src/lib/csv';
import { db } from '../src/lib/db';
afterAll(() => db.$disconnect());
describe('dashboard and reports', () => {
  it('reconciles current event balances through settlement and correction with isolated analytics', async () => {
    const f = await salesFixture();
    await paymentAction(f.actors.SUPER_ADMIN, 'promptpay.save', {
      type: 'PHONE',
      identifier: '0812345678',
      displayName: 'TEST ONLY',
      enabled: true,
    });
    await orderAction(f.actors.CASHIER, 'order.create', f.orderInput(4));
    let s = await report(f.actors.SUPER_ADMIN, f.event.id);
    expect(s.grossSalesSatang).toBe(18200);
    expect(s.netSalesSatang).toBe(s.confirmedPaymentSatang + s.outstandingSatang);
    expect(s.byProduct[0].quantity).toBe(4);
    expect(s.byCategory[0].amountSatang).toBe(18200);
    const recorded = await db.order.findFirstOrThrow({ where: { eventId: f.event.id } });
    const expectedHour =
      new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(recorded.createdAt) + ':00';
    expect(s.byHour[0].label).toBe(expectedHour);
    expect(s.outstandingTrend.at(-1)?.amountSatang).toBe(18200);
    const p = (await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
      eventId: f.event.id,
      stationId: f.stations[3].id,
      token: f.registration.token,
      key: randomUUID(),
    })) as { id: string };
    await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', {
      paymentId: p.id,
      stationId: f.stations[3].id,
      key: randomUUID(),
      reference: randomUUID(),
      evidence: 'Bank evidence checked',
      evidenceVerified: true,
    });
    s = await report(f.actors.SUPER_ADMIN, f.event.id);
    expect(s.confirmedPaymentSatang).toBe(18200);
    expect(s.outstandingSatang).toBe(0);
    expect(s.reconciled).toBe(true);
    expect(s.settled).toBe(1);
    await controlAction(f.actors.SUPER_ADMIN, 'payment.void', {
      id: p.id,
      key: randomUUID(),
      reason: 'Correction',
    });
    s = await report(f.actors.SUPER_ADMIN, f.event.id);
    expect(s.confirmedPaymentSatang).toBe(0);
    expect(s.outstandingSatang).toBe(18200);
    expect(s.outstandingTrend.at(-1)?.amountSatang).toBe(18200);
    expect(s.reconciled).toBe(true);
    const other = await salesFixture();
    expect((await report(other.actors.SUPER_ADMIN, other.event.id)).orders).toBe(0);
    await expect(report(f.actors.CASHIER, f.event.id)).rejects.toThrow('not authorized');
    const old = await report(f.actors.SUPER_ADMIN, f.event.id, '2000-01-01', '2000-01-02');
    expect(old.orders).toBe(0);
    expect(old.outstandingSatang).toBe(18200);
    expect(old.rangeFiltered).toBe(true);
  });
  it('escapes spreadsheet formulas and embedded CSV quotes', () => {
    expect(csvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"');
    expect(csvCell('normal,"text"')).toBe('"normal,""text"""');
    expect(csvCell('\t=cmd')).toContain("'");
  });
});
