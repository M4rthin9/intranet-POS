import type { Tx } from './db';
import type { Actor } from './audit';
import { AppError } from './rbac';
import { Prisma } from '@prisma/client';
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
) {
  const value = await tx.station.findUnique({ where: { id } });
  if (!value?.active || (value.type !== type && value.type !== 'ADMIN'))
    throw new AppError(409, 'Station is inactive or has the wrong type.');
  return value;
}
export async function shift(tx: Tx, actor: Actor, eventId: string, stationId: string) {
  const value = await tx.shift.findFirst({
    where: { userId: actor.id, eventId, stationId, closedAt: null },
  });
  if (!value) throw new AppError(409, 'Open your shift at this station before continuing.');
  return value;
}
