import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers';
import { db } from '../src/lib/db';
import { manage } from '../src/lib/management';
import { resolveOperatingContext } from '../src/lib/operating-context';
import { registrationAction } from '../src/lib/registration';
import { catalogAction } from '../src/lib/catalog';
import { orderAction } from '../src/lib/orders';
import { paymentAction } from '../src/lib/payments';
import { operationsAction } from '../src/lib/operations';
import { readData } from '../src/lib/data';
import { dashboard } from '../src/lib/reports';
afterAll(() => db.$disconnect());

describe('Super Admin event assignments and automatic staff sessions', () => {
  it('requires a staff event, enforces Super Admin assignment and rejects foreign event reads/writes', async () => {
    const f = await fixture();
    const input = {
      username: `assigned-${f.tag}`,
      displayName: 'Assigned staff',
      roleName: 'REGISTRATION_CASHIER',
      password: 'test-password-12345',
    };
    await expect(
      manage(f.actors.ADMIN, 'user.save', { ...input, assignedEventId: f.fixtureEvent.id }),
    ).rejects.toThrow('not authorized');
    await expect(manage(f.actors.SUPER_ADMIN, 'user.save', input)).rejects.toThrow(
      'Select an event',
    );
    const user = (await manage(f.actors.SUPER_ADMIN, 'user.save', {
      ...input,
      assignedEventId: f.fixtureEvent.id,
    })) as { id: string };
    const actor = { id: user.id, roleName: 'REGISTRATION_CASHIER' as const };
    const other = await db.event.create({
      data: { code: `OTHER-${f.tag}`, name: 'Other event', status: 'OPEN' },
    });
    const context = await resolveOperatingContext(actor, { eventId: other.id });
    expect(context.event.id).toBe(f.fixtureEvent.id);
    expect(context.shiftOpen).toBe(true);
    expect(
      ((await readData(actor, 'events')) as { id: string }[]).map((event) => event.id),
    ).toEqual([f.fixtureEvent.id]);
    await expect(
      resolveOperatingContext(actor, { eventId: other.id, switchEvent: true }),
    ).rejects.toThrow('Only Super Admin');
    await expect(readData(actor, 'registrations', other.id)).rejects.toThrow('not assigned');
    await expect(dashboard(f.actors.ADMIN, other.id)).rejects.toThrow('not assigned');
    await expect(
      registrationAction(actor, 'registration.create', {
        eventId: other.id,
        stationId: context.station.id,
        customerName: 'Forbidden',
      }),
    ).rejects.toThrow('not assigned');
    expect(await db.registration.count({ where: { eventId: other.id } })).toBe(0);
    await db.user.update({ where: { id: actor.id }, data: { assignedEventId: null } });
    await expect(resolveOperatingContext(actor, {})).rejects.toThrow('assign your event');
    expect(await readData(actor, 'events')).toEqual([]);
  });

  it('automatically opens sale/payment sessions, blocks unsafe reassignment, then closes them with reconciled summaries', async () => {
    const f = await fixture();
    const registration = (await registrationAction(f.actors.ADMIN, 'registration.create', {
      eventId: f.fixtureEvent.id,
      stationId: f.stations[0].id,
      customerName: 'Automatic workflow',
    })) as { token: string };
    const category = (await catalogAction(f.actors.SUPER_ADMIN, 'category.save', {
      name: `AUTO-${f.tag}`,
    })) as { id: string };
    const product = (await catalogAction(f.actors.SUPER_ADMIN, 'product.save', {
      code: f.tag,
      name: 'Tea',
      categoryId: category.id,
      priceBaht: '45.50',
    })) as { id: string };
    expect(await db.shift.count({ where: { eventId: f.fixtureEvent.id } })).toBe(0);
    const order = (await orderAction(f.actors.CASHIER, 'order.create', {
      eventId: f.fixtureEvent.id,
      stationId: f.stations[1].id,
      token: registration.token,
      key: randomUUID(),
      items: [{ productId: product.id, quantity: 1 }],
    })) as { id: string; shiftId: string };
    await paymentAction(f.actors.SUPER_ADMIN, 'promptpay.save', {
      type: 'PHONE',
      identifier: '0812345678',
      displayName: 'TEST ONLY',
      enabled: true,
    });
    const payment = (await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
      eventId: f.fixtureEvent.id,
      stationId: f.stations[3].id,
      token: registration.token,
      key: randomUUID(),
    })) as { id: string; shiftId: string };
    const user = await db.user.findUniqueOrThrow({ where: { id: f.actors.PAYMENT_CASHIER.id } });
    const other = await db.event.create({
      data: { code: `NEXT-${f.tag}`, name: 'Next event', status: 'OPEN' },
    });
    const update = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      roleName: user.roleName,
      assignedEventId: other.id,
    };
    await expect(manage(f.actors.SUPER_ADMIN, 'user.save', update)).rejects.toThrow(
      'Resolve pending payments',
    );
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).assignedEventId).toBe(
      f.fixtureEvent.id,
    );
    await expect(
      operationsAction(f.actors.SUPER_ADMIN, 'event.close', { eventId: f.fixtureEvent.id }),
    ).rejects.toThrow('Resolve all pending payments');
    await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', {
      paymentId: payment.id,
      stationId: f.stations[3].id,
      key: randomUUID(),
      reference: randomUUID(),
      evidence: 'Isolated evidence',
      evidenceVerified: true,
    });
    await manage(f.actors.SUPER_ADMIN, 'user.save', update);
    expect(
      (await db.shift.findUniqueOrThrow({ where: { id: payment.shiftId } })).closedAt,
    ).not.toBeNull();
    await expect(
      paymentAction(f.actors.PAYMENT_CASHIER, 'receipt.print', { paymentId: payment.id }),
    ).rejects.toThrow('not assigned');
    await operationsAction(f.actors.SUPER_ADMIN, 'event.close', { eventId: f.fixtureEvent.id });
    expect(await db.shift.count({ where: { eventId: f.fixtureEvent.id, closedAt: null } })).toBe(0);
    expect(
      (await db.shift.findUniqueOrThrow({ where: { id: order.shiftId } })).summary,
    ).toMatchObject({ grossSalesSatang: 4550, netSalesSatang: 4550 });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).shiftId).toBe(
      order.shiftId,
    );
    const next = await resolveOperatingContext(f.actors.PAYMENT_CASHIER, {});
    expect(next.event.id).toBe(other.id);
    expect(next.shiftOpen).toBe(true);
  });
});
