import { describe, it, expect, afterAll } from 'vitest';
import { fixture, assignFixtureEvent } from './helpers';
import { db, transaction } from '../src/lib/db';
import { registrationAction, resolveAccount } from '../src/lib/registration';
import type { PrintDto } from '../src/components/types';
afterAll(() => db.$disconnect());
describe('event registration and QR', () => {
  it('issues opaque QR, preserves account during reissue, rejects old/blocked/wrong-event QR', async () => {
    const f = await fixture();
    const event = (await registrationAction(f.actors.SUPER_ADMIN, 'event.save', {
      code: f.tag,
      name: 'Test event',
      status: 'OPEN',
    })) as { id: string };
    await assignFixtureEvent(f, event.id);
    const result = (await registrationAction(f.actors.ADMIN, 'registration.create', {
      eventId: event.id,
      stationId: f.stations[0].id,
      customerName: 'ผู้ร่วมงาน',
    })) as unknown as PrintDto & { id: string; token: string; account: { id: string } };
    expect(result.token).toMatch(/^CCA-[A-Za-z0-9_-]{43}$/);
    expect(result.qrImage).toContain('data:image/png');
    expect(result.event).toEqual({ code: f.tag, name: 'Test event' });
    const issued = await db.qrCredential.findUniqueOrThrow({ where: { token: result.token } });
    expect(result.issuedAt).toBe(issued.issuedAt.toISOString());
    // Printing uses this registration's event, not a browser's selected event.
    await registrationAction(f.actors.SUPER_ADMIN, 'event.save', {
      id: event.id,
      code: f.tag,
      name: 'Updated event name',
      status: 'OPEN',
    });
    const printed = (await registrationAction(f.actors.ADMIN, 'qr.print', {
      registrationId: result.id,
    })) as PrintDto;
    expect(printed.event).toEqual({ code: f.tag, name: 'Updated event name' });
    expect(printed.issuedAt).toBe(result.issuedAt);
    expect(printed.token).toBe(result.token);
    expect((await transaction((tx) => resolveAccount(tx, event.id, result.token))).id).toBe(
      result.account.id,
    );
    await expect(transaction((tx) => resolveAccount(tx, event.id, 'invalid'))).rejects.toThrow(
      'Invalid',
    );
    await expect(
      transaction((tx) => resolveAccount(tx, 'wrong-event', result.token)),
    ).rejects.toThrow('wrong-event');
    const replaced = (await registrationAction(f.actors.ADMIN, 'qr.reissue', {
      registrationId: result.id,
      reason: 'Lost original card',
    })) as PrintDto & { token: string };
    const reissued = await db.qrCredential.findUniqueOrThrow({ where: { token: replaced.token } });
    expect(replaced.issuedAt).toBe(reissued.issuedAt.toISOString());
    expect(replaced.event).toEqual(printed.event);
    expect((await transaction((tx) => resolveAccount(tx, event.id, replaced.token))).id).toBe(
      result.account.id,
    );
    await expect(transaction((tx) => resolveAccount(tx, event.id, result.token))).rejects.toThrow(
      'revoked',
    );
    expect(await db.qrCredential.count({ where: { accountId: result.account.id } })).toBe(2);
    await registrationAction(f.actors.ADMIN, 'qr.block', {
      registrationId: result.id,
      reason: 'Security review',
    });
    await expect(transaction((tx) => resolveAccount(tx, event.id, replaced.token))).rejects.toThrow(
      'BLOCKED',
    );
    await expect(registrationAction(f.actors.CASHIER, 'registration.create', {})).rejects.toThrow(
      'not authorized',
    );
  });
});
