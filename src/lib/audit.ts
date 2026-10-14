import { Prisma, type RoleName } from '@prisma/client';
import type { Tx } from './db';
export type Actor = { id: string; roleName: RoleName; ipAddress?: string; userAgent?: string };
export async function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string,
  data: {
    eventId?: string;
    stationId?: string;
    before?: unknown;
    after?: unknown;
    reason?: string;
  } = {},
) {
  const json = (value: unknown) =>
    value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
  return tx.auditLog.create({
    data: {
      actorUserId: actor.id,
      actorRole: actor.roleName,
      action,
      entityType,
      entityId,
      eventId: data.eventId,
      stationId: data.stationId,
      before: json(data.before),
      after: json(data.after),
      reason: data.reason,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    },
  });
}
