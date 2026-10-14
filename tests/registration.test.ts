import { describe, it, expect, afterAll } from 'vitest';
import { fixture } from './helpers';
import { db, transaction } from '../src/lib/db';
import { registrationAction, resolveAccount } from '../src/lib/registration';
afterAll(() => db.$disconnect());
describe('event registration and QR', () => {
  it('issues opaque QR, preserves account during reissue, rejects old/blocked/wrong-event QR', async () => {
    const f = await fixture();
    const event = (await registrationAction(f.actors.SUPER_ADMIN, 'event.save', {
      code: f.tag,
      name: 'Test event',
      status: 'OPEN',
    })) as { id: string };
    const result = (await registrationAction(f.actors.ADMIN, 'registration.create', {
      eventId: event.id,
      stationId: f.stations[0].id,
      customerName: 'ผู้ร่วมงาน',
    })) as unknown as { id: string; token: string; account: { id: string }; qrImage: string };
    expect(result.token).toMatch(/^CCA-[A-Za-z0-9_-]{43}$/);
    expect(result.qrImage).toContain('data:image/png');
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
    })) as { token: string };
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
