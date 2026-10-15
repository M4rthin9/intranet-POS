import type { Actor } from './audit';
import type { Tx } from './db';
import { AppError } from './rbac';

export async function assignedEvent(tx: Tx, actor: Actor) {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: actor.id },
    include: { assignedEvent: true },
  });
  if (!user.active) throw new AppError(401, 'This account is disabled. Please sign in again.');
  if (!user.assignedEvent)
    throw new AppError(
      409,
      'ยังไม่ได้ผูกกิจกรรม กรุณาติดต่อผู้ดูแลระบบ / Ask Super Admin to assign your event.',
    );
  return user.assignedEvent;
}

export async function requireAssignedEvent(tx: Tx, actor: Actor, eventId: string) {
  if (actor.roleName === 'SUPER_ADMIN') return;
  if ((await assignedEvent(tx, actor)).id !== eventId)
    throw new AppError(
      403,
      'คุณไม่มีสิทธิ์เข้าถึงกิจกรรมนี้ / This event is not assigned to your account.',
    );
}
