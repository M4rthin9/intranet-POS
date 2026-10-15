import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';
import type { RoleName } from '@prisma/client';
export async function fixture() {
  const tag = randomUUID().slice(0, 8);
  const fixtureEvent = await db.event.create({
    data: { code: `FIXTURE-${tag}`, name: 'Assigned fixture event', status: 'OPEN' },
  });
  const actors = {} as Record<RoleName, { id: string; roleName: RoleName }>;
  for (const roleName of [
    'SUPER_ADMIN',
    'ADMIN',
    'CASHIER',
    'PAYMENT_CASHIER',
    'REGISTRATION_CASHIER',
  ] as const) {
    await db.role.upsert({ where: { name: roleName }, create: { name: roleName }, update: {} });
    const u = await db.user.create({
      data: {
        username: `${tag}-${roleName}`,
        displayName: roleName,
        roleName,
        assignedEventId: roleName === 'SUPER_ADMIN' ? null : fixtureEvent.id,
        passwordHash: hashPassword('test-password-12345'),
      },
    });
    actors[roleName] = { id: u.id, roleName };
  }
  const stations = [];
  for (const type of ['REGISTRATION', 'POS', 'POS', 'PAYMENT'] as const)
    stations.push(
      await db.station.create({ data: { code: `${tag}-${stations.length}`, name: type, type } }),
    );
  return { tag, actors, stations, fixtureEvent };
}
export async function assignFixtureEvent(
  f: { actors: Record<string, { id: string; roleName: RoleName }> },
  eventId: string,
) {
  await db.user.updateMany({
    where: {
      id: {
        in: Object.values(f.actors)
          .filter((actor) => actor.roleName !== 'SUPER_ADMIN')
          .map((actor) => actor.id),
      },
    },
    data: { assignedEventId: eventId },
  });
}
