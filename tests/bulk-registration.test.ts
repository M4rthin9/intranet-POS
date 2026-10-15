import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { db, transaction } from '../src/lib/db';
import { registrationAction, resolveAccount } from '../src/lib/registration';
import { fixture } from './helpers';

afterAll(() => db.$disconnect());
const action = 'registration.bulk.create';
describe('bulk registration', () => {
  it('creates Normal and VIP batches with separate working QR accounts, audits and safe retries', async () => {
    const f = await fixture();
    for (const isVip of [false, true]) {
      const input = {
        eventId: f.fixtureEvent.id,
        stationId: f.stations[0].id,
        key: randomUUID(),
        isVip,
        names: Array.from({ length: 100 }, (_, index) => `Customer ${index + 1}`),
        group: 'Guests',
        tableNumber: 'A1',
      };
      const result = await registrationAction(f.actors.REGISTRATION_CASHIER, action, input);
      expect(await registrationAction(f.actors.REGISTRATION_CASHIER, action, input)).toEqual(
        result,
      );
      const rows = await db.registration.findMany({
        where: { eventId: input.eventId, isVip },
        include: { account: { include: { credentials: true } } },
      });
      expect(rows).toHaveLength(100);
      expect(new Set(rows.map((row) => row.number)).size).toBe(100);
      const tokens = rows.map((row) => row.account!.credentials[0].token);
      expect(new Set(tokens).size).toBe(100);
      expect(
        rows.every(
          (row) => row.group === 'Guests' && row.tableNumber === 'A1' && row.guestCount === 1,
        ),
      ).toBe(true);
      expect((await transaction((tx) => resolveAccount(tx, input.eventId, tokens[0]))).id).toBe(
        rows[0].account!.id,
      );
      expect(
        await db.auditLog.count({
          where: {
            eventId: input.eventId,
            action: 'REGISTRATION_CREATE',
            entityId: { in: rows.map((row) => row.id) },
          },
        }),
      ).toBe(100);
      expect(
        await db.auditLog.count({
          where: {
            eventId: input.eventId,
            action: 'QR_CREATE',
            entityId: { in: rows.map((row) => row.account!.id) },
          },
        }),
      ).toBe(100);
      await expect(
        registrationAction(f.actors.REGISTRATION_CASHIER, action, { ...input, names: ['Changed'] }),
      ).rejects.toThrow('different data');
    }
  });

  it('validates the whole batch and enforces permissions, assignment, station and open event', async () => {
    const f = await fixture();
    const input = {
      eventId: f.fixtureEvent.id,
      stationId: f.stations[0].id,
      key: randomUUID(),
      names: ['Valid', '  '],
    };
    for (const names of [[], ['Valid', '  '], ['a'.repeat(121)], Array(101).fill('Guest')]) {
      await expect(
        registrationAction(f.actors.ADMIN, action, { ...input, names }),
      ).rejects.toThrow();
    }
    const valid = { ...input, names: ['Guest'] };
    await expect(registrationAction(f.actors.CASHIER, action, valid)).rejects.toThrow(
      'not authorized',
    );
    await expect(
      registrationAction(f.actors.ADMIN, action, { ...valid, stationId: f.stations[1].id }),
    ).rejects.toThrow('wrong type');
    const other = await fixture();
    await expect(
      registrationAction(f.actors.ADMIN, action, { ...valid, eventId: other.fixtureEvent.id }),
    ).rejects.toThrow();
    await db.event.update({ where: { id: input.eventId }, data: { status: 'CLOSED' } });
    await expect(registrationAction(f.actors.ADMIN, action, valid)).rejects.toThrow('not open');
    expect(await db.registration.count({ where: { eventId: input.eventId } })).toBe(0);
  });
});
