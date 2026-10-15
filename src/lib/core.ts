import type { Tx } from './db';
import type { Actor } from './audit';
import { AppError } from './rbac';
import { Prisma, type RoleName } from '@prisma/client';
import { audit } from './audit';
import { requireAssignedEvent } from './event-assignment';
export async function number(tx: Tx, prefix: 'REG' | 'ORD' | 'PAY') {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replaceAll('-', '');
  const names = {
    REG: 'public.ccida_registration_number',
    ORD: 'public.ccida_order_number',
    PAY: 'public.ccida_payment_number',
  };
  const rows = await tx.$queryRaw<Array<{ value: bigint }>>(
    Prisma.sql`SELECT nextval(${names[prefix]}::regclass) AS value`,
  );
  return `${prefix}-${date}-${String(rows[0].value).padStart(6, '0')}`;
}
export async function openEvent(tx: Tx, eventId: string) {
  const event = await tx.event.findUnique({ where: { id: eventId } });
  if (!event || event.status !== 'OPEN') throw new AppError(409, 'Event is not open.');
  return event;
}
export async function station(
  tx: Tx,
  id: string,
  type: 'REGISTRATION' | 'POS' | 'PAYMENT' | 'ADMIN',
  roleName?: RoleName,
) {
  const value = await tx.station.findUnique({ where: { id } });
  // Match shift.open: authenticated super administrators can perform every workflow
  // at an active station. Keep type restrictions for other roles and require an own shift.
  if (
    !value?.active ||
    (roleName !== 'SUPER_ADMIN' && value.type !== type && value.type !== 'ADMIN')
  )
    throw new AppError(409, 'Station is inactive or has the wrong type.');
  return value;
}
export async function shift(tx: Tx, actor: Actor, eventId: string, stationId: string) {
  await requireAssignedEvent(tx, actor, eventId);
  const value = await tx.shift.findFirst({
    where: { userId: actor.id, eventId, stationId, closedAt: null },
  });
  if (!value && actor.roleName !== 'SUPER_ADMIN') {
    await openEvent(tx, eventId);
    if (
      await tx.shift.count({ where: { closedAt: null, OR: [{ userId: actor.id }, { stationId }] } })
    )
      throw new AppError(
        409,
        'Operating session conflicts with this assignment. Contact Super Admin.',
      );
    const created = await tx.shift.create({ data: { userId: actor.id, eventId, stationId } });
    await audit(tx, actor, 'SHIFT_OPEN', 'Shift', created.id, {
      eventId,
      stationId,
      after: created,
      reason: 'Automatic session for the assigned event',
    });
    return created;
  }
  if (!value) throw new AppError(409, 'Open your shift at this station before continuing.');
  return value;
}
