import { z } from 'zod';
import { transaction } from './db';
import { audit, type Actor } from './audit';
import { AppError, requirePermission } from './rbac';
import type { StationType } from '@prisma/client';
import { assignedEvent } from './event-assignment';
import { shift as ensureShift } from './core';

// Work assignments retain their shift boundary; explicit event switches must be safe.
export async function resolveOperatingContext(actor: Actor, input: unknown) {
  requirePermission(actor.roleName, 'event.view');
  requirePermission(actor.roleName, 'station.view');
  const preferred = z
    .object({
      eventId: z.string().uuid().optional(),
      stationId: z.string().uuid().optional(),
      switchEvent: z.boolean().default(false),
    })
    .parse(input);
  return transaction(async (tx) => {
    const staffEvent = actor.roleName !== 'SUPER_ADMIN' ? await assignedEvent(tx, actor) : null;
    if (staffEvent && preferred.switchEvent && preferred.eventId !== staffEvent.id)
      throw new AppError(403, 'Only Super Admin can change your assigned event.');
    const key = `operating-context:${actor.id}`;
    const setting = await tx.systemSetting.findUnique({ where: { key } });
    const saved = z
      .object({ eventId: z.string().uuid(), stationId: z.string().uuid() })
      .safeParse(setting?.value);
    const remembered = saved.success ? saved.data : undefined;
    const remember = async (eventId: string, stationId: string) => {
      if (remembered?.eventId === eventId && remembered.stationId === stationId) return;
      await tx.systemSetting.upsert({
        where: { key },
        create: { key, value: { eventId, stationId } },
        update: { value: { eventId, stationId } },
      });
    };
    const shift = await tx.shift.findFirst({
      where: { userId: actor.id, closedAt: null },
      include: { event: true, station: true },
    });
    if (shift) {
      if (!shift.station.active)
        throw new AppError(409, 'Your operating assignment is disabled. Contact an administrator.');
      if (staffEvent && shift.eventId !== staffEvent.id)
        throw new AppError(
          409,
          'Your existing session has a different event. Ask Super Admin to reconcile the assignment.',
        );
      if (preferred.switchEvent && preferred.eventId && preferred.eventId !== shift.eventId)
        throw new AppError(409, 'Close your current shift before switching the sales event.');
      await remember(shift.eventId, shift.stationId);
      return { event: shift.event, station: shift.station, shiftOpen: true };
    }
    let event =
      staffEvent ??
      (await tx.event.findFirst({
        where: { id: preferred.eventId ?? remembered?.eventId ?? 'none', status: 'OPEN' },
      }));
    if (!staffEvent && preferred.switchEvent && (!preferred.eventId || !event))
      throw new AppError(
        409,
        'Select an open event before registering customers or recording sales.',
      );
    event ??= await tx.event.findFirst({ where: { code: 'DEMO-CCIDA-TEST', status: 'OPEN' } });
    event ??= await tx.event.findFirst({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
    });
    if (!event) {
      if (await tx.event.count())
        throw new AppError(
          409,
          'Operations are closed. An administrator must configure an open operating period.',
        );
      event = await tx.event.create({
        data: { code: 'CCIDA-INTERNAL', name: 'CCIDA POS', status: 'OPEN' },
      });
      await audit(tx, actor, 'EVENT_CREATE', 'Event', event.id, {
        eventId: event.id,
        after: event,
        reason: 'Automatic initial operating period',
      });
    }

    const type: StationType =
      actor.roleName === 'ADMIN' || actor.roleName === 'REGISTRATION_CASHIER'
        ? 'REGISTRATION'
        : actor.roleName === 'CASHIER'
          ? 'POS'
          : actor.roleName === 'PAYMENT_CASHIER'
            ? 'PAYMENT'
            : 'ADMIN';
    let station = await tx.station.findFirst({
      where: {
        id: preferred.stationId ?? remembered?.stationId ?? 'none',
        active: true,
        type: { in: [type, 'ADMIN'] },
        shifts: { none: { closedAt: null, userId: { not: actor.id } } },
      },
    });
    if (!station) {
      const prefix = { REGISTRATION: 'REG', POS: 'POS', PAYMENT: 'PAY', ADMIN: 'ADM' }[type];
      const code = `A-${prefix}-${actor.id.replaceAll('-', '')}`;
      station = await tx.station.findUnique({ where: { code } });
      station ??= await tx.station.findUnique({ where: { code: `AUTO-${type}-${actor.id}` } });
      if (!station) {
        station = await tx.station.create({
          data: { code, name: 'CCIDA POS', type, active: true },
        });
        await audit(tx, actor, 'STATION_CREATE', 'Station', station.id, {
          eventId: event.id,
          stationId: station.id,
          after: station,
          reason: 'Automatic operator assignment',
        });
      }
      if (!station.active || station.type !== type)
        throw new AppError(409, 'Your operating assignment is disabled. Contact an administrator.');
      if (
        await tx.shift.count({
          where: { stationId: station.id, closedAt: null, userId: { not: actor.id } },
        })
      )
        throw new AppError(409, 'Your operating assignment is in use. Contact an administrator.');
    }
    await remember(event.id, station.id);
    if (staffEvent && event.status === 'OPEN') {
      await ensureShift(tx, actor, event.id, station.id);
      return { event, station, shiftOpen: true };
    }
    return { event, station, shiftOpen: false };
  });
}
