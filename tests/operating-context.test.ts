import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { fixture, assignFixtureEvent } from './helpers';
import { manage } from '../src/lib/management';
import { salesFixture } from './sales-helpers';
import { resolveOperatingContext } from '../src/lib/operating-context';
import { orderAction } from '../src/lib/orders';
import { registrationAction } from '../src/lib/registration';
import { paymentAction } from '../src/lib/payments';
import { transaction } from '../src/lib/db';
import { station } from '../src/lib/core';
import { randomUUID } from 'node:crypto';

afterAll(() => db.$disconnect());

describe('automatic operating assignments', () => {
  it('rejects explicit event switches during a shift, then preserves separate event ledgers after switching', async () => {
    const f = await salesFixture();
    const second = (await registrationAction(f.actors.SUPER_ADMIN, 'event.save', {
      code: `SECOND-${f.tag}`,
      name: 'Second sales event',
      status: 'OPEN',
    })) as { id: string };
    await orderAction(f.actors.CASHIER, 'order.create', f.orderInput());
    await expect(
      resolveOperatingContext(f.actors.CASHIER, {
        eventId: second.id,
        switchEvent: true,
      }),
    ).rejects.toThrow('Only Super Admin');
    const currentShift = await db.shift.findFirstOrThrow({
      where: { userId: f.actors.CASHIER.id, closedAt: null },
    });
    const cashier = await db.user.findUniqueOrThrow({ where: { id: f.actors.CASHIER.id } });
    await manage(f.actors.SUPER_ADMIN, 'user.save', {
      id: cashier.id,
      username: cashier.username,
      displayName: cashier.displayName,
      roleName: cashier.roleName,
      active: true,
      assignedEventId: second.id,
    });
    const switched = await resolveOperatingContext(f.actors.CASHIER, {
      eventId: second.id,
      stationId: f.stations[1].id,
      switchEvent: true,
    });
    expect(switched.event.id).toBe(second.id);
    expect(switched.shiftOpen).toBe(true);
    await orderAction(f.actors.CASHIER, 'shift.open', {
      eventId: second.id,
      stationId: switched.station.id,
    });
    await db.user.update({
      where: { id: f.actors.ADMIN.id },
      data: { assignedEventId: second.id },
    });
    const customer = (await registrationAction(f.actors.ADMIN, 'registration.create', {
      eventId: second.id,
      stationId: f.stations[0].id,
      customerName: 'Second event customer',
    })) as { token: string };
    await expect(
      orderAction(f.actors.CASHIER, 'order.create', {
        ...f.orderInput(),
        eventId: second.id,
      }),
    ).rejects.toThrow('wrong-event QR');
    await orderAction(f.actors.CASHIER, 'order.create', {
      ...f.orderInput(2),
      eventId: second.id,
      token: customer.token,
      stationId: switched.station.id,
    });
    const { dashboard } = await import('../src/lib/reports');
    expect((await dashboard(f.actors.SUPER_ADMIN, f.event.id)).netSalesSatang).toBe(4550);
    expect((await dashboard(f.actors.SUPER_ADMIN, second.id)).netSalesSatang).toBe(9100);
    expect((await db.order.findFirstOrThrow({ where: { eventId: f.event.id } })).shiftId).toBe(
      currentShift.id,
    );
  });

  it('rejects explicit closed or missing events instead of silently assigning another open event', async () => {
    const f = await fixture();
    const closed = await db.event.create({
      data: { code: `CLOSED-${f.tag}`, name: 'Historical event', status: 'CLOSED' },
    });
    await expect(
      resolveOperatingContext(f.actors.SUPER_ADMIN, {
        eventId: closed.id,
        switchEvent: true,
      }),
    ).rejects.toThrow('Select an open event');
    await expect(
      resolveOperatingContext(f.actors.SUPER_ADMIN, {
        eventId: randomUUID(),
        switchEvent: true,
      }),
    ).rejects.toThrow('Select an open event');
  });
  it('lets a super administrator register, sell and settle on an existing specialized shift without moving history', async () => {
    const f = await salesFixture();
    const actor = f.actors.SUPER_ADMIN;
    const existing = (await orderAction(actor, 'shift.open', {
      eventId: f.event.id,
      stationId: f.stations[0].id,
    })) as { id: string };
    const assigned = await resolveOperatingContext(actor, {});
    expect(assigned.station.id).toBe(f.stations[0].id);
    const customer = (await registrationAction(actor, 'registration.create', {
      eventId: assigned.event.id,
      stationId: assigned.station.id,
      customerName: 'Cross-workflow administrator regression',
    })) as { token: string; registrationId: string };
    const order = (await orderAction(actor, 'order.create', {
      ...f.orderInput(),
      token: customer.token,
      stationId: assigned.station.id,
    })) as { id: string; totalSatang: number; shiftId: string };
    expect(order.totalSatang).toBe(4550);
    expect(order.shiftId).toBe(existing.id);
    await paymentAction(actor, 'promptpay.save', {
      type: 'PHONE',
      identifier: '0812345678',
      displayName: 'TEST ONLY',
      enabled: true,
    });
    const payment = (await paymentAction(actor, 'payment.generate', {
      eventId: assigned.event.id,
      stationId: assigned.station.id,
      token: customer.token,
      key: randomUUID(),
    })) as { id: string; amountSatang: number };
    expect(payment.amountSatang).toBe(4550);
    await paymentAction(actor, 'payment.confirm', {
      paymentId: payment.id,
      stationId: assigned.station.id,
      key: randomUUID(),
      reference: randomUUID(),
      evidence: 'Isolated regression evidence',
      evidenceVerified: true,
    });
    expect(
      (
        await db.customerAccount.findUniqueOrThrow({
          where: { registrationId: customer.registrationId },
        })
      ).status,
    ).toBe('SETTLED');
    expect((await db.station.findUniqueOrThrow({ where: { id: assigned.station.id } })).type).toBe(
      'REGISTRATION',
    );
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).shiftId).toBe(
      existing.id,
    );
    await expect(
      transaction((tx) => station(tx, assigned.station.id, 'POS', 'CASHIER')),
    ).rejects.toThrow('wrong type');
    await expect(
      transaction((tx) => station(tx, assigned.station.id, 'PAYMENT', 'PAYMENT_CASHIER')),
    ).rejects.toThrow('wrong type');
    await db.station.update({ where: { id: assigned.station.id }, data: { active: false } });
    await expect(
      transaction((tx) => station(tx, assigned.station.id, 'POS', 'SUPER_ADMIN')),
    ).rejects.toThrow('inactive');
  });
  it('preserves an existing shift and its ledger even when browser preferences differ', async () => {
    const f = await salesFixture();
    const result = await resolveOperatingContext(f.actors.CASHIER, {
      eventId: crypto.randomUUID(),
      stationId: f.stations[3].id,
    });
    expect(result.event.id).toBe(f.event.id);
    expect(result.station.id).toBe(f.stations[1].id);
    await orderAction(f.actors.CASHIER, 'order.create', f.orderInput());
    const order = await db.order.findFirstOrThrow({ where: { eventId: f.event.id } });
    expect(order.stationId).toBe(result.station.id);
    const saved = await db.systemSetting.findUniqueOrThrow({
      where: { key: `operating-context:${f.actors.CASHIER.id}` },
    });
    expect(saved.value).toEqual({ eventId: f.event.id, stationId: f.stations[1].id });
  });

  it('assigns all five roles safely and provisions only once under concurrent retries', async () => {
    const f = await fixture();
    const event = await db.event.create({
      data: { code: `AUTO-${f.tag}`, name: 'Automatic assignment test', status: 'OPEN' },
    });
    await assignFixtureEvent(f, event.id);
    for (const [role, type] of [
      ['ADMIN', 'REGISTRATION'],
      ['CASHIER', 'POS'],
      ['PAYMENT_CASHIER', 'PAYMENT'],
      ['SUPER_ADMIN', 'ADMIN'],
      ['REGISTRATION_CASHIER', 'REGISTRATION'],
    ] as const) {
      const actor = f.actors[role];
      const results = await Promise.all(
        [1, 2, 3].map(() => resolveOperatingContext(actor, { eventId: event.id })),
      );
      expect(new Set(results.map((result) => result.station.id)).size).toBe(1);
      expect(results[0].station.type).toBe(type);
      expect(results[0].station.code.length).toBeLessThanOrEqual(40);
      expect(results[0].event.id).toBe(event.id);
      expect(
        await db.auditLog.count({
          where: { action: 'STATION_CREATE', entityId: results[0].station.id },
        }),
      ).toBe(1);
      const restored = await resolveOperatingContext(actor, {});
      expect(restored.station.id).toBe(results[0].station.id);
      expect(restored.event.id).toBe(event.id);
      await orderAction(actor, 'shift.open', { eventId: event.id, stationId: restored.station.id });
    }
    expect(await db.shift.count({ where: { eventId: event.id, closedAt: null } })).toBe(5);
  });

  it('rejects disabled automatic assignments and avoids occupied or incompatible stations', async () => {
    const f = await salesFixture();
    const registration = await resolveOperatingContext(f.actors.ADMIN, {
      eventId: f.event.id,
      stationId: f.stations[1].id,
    });
    expect(registration.station.type).toBe('REGISTRATION');
    expect(registration.station.id).not.toBe(f.stations[1].id);
    await db.station.update({ where: { id: registration.station.id }, data: { active: false } });
    await expect(resolveOperatingContext(f.actors.ADMIN, {})).rejects.toThrow('disabled');
    expect(await db.station.count({ where: { id: registration.station.id } })).toBe(1);
    await expect(resolveOperatingContext(f.actors.ADMIN, { eventId: 'invalid' })).rejects.toThrow();
  });
});
