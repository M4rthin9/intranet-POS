import { db } from './db';
import type { Actor } from './audit';
import { requirePermission, AppError } from './rbac';
import { receiptLayout } from './receipt-layout';
import { assignedEvent, requireAssignedEvent } from './event-assignment';
export async function readData(
  actor: Actor,
  view: string,
  eventId?: string,
  search = '',
  customerType: 'all' | 'normal' | 'vip' = 'all',
) {
  if (view === 'backup-schedule') {
    requirePermission(actor.roleName, 'backup.manage');
    return (
      (await db.systemSetting.findUnique({ where: { key: 'backup-schedule' } }))?.value ?? null
    );
  }
  if (view === 'stock') {
    requirePermission(actor.roleName, 'stock.manage');
    if (!eventId) throw new AppError(400, 'Select an event.');
    return db.inventory.findMany({
      where: { eventId },
      include: { product: true, movements: { orderBy: { createdAt: 'desc' }, take: 100 } },
      orderBy: { product: { name: 'asc' } },
    });
  }
  if (view === 'closing') {
    requirePermission(actor.roleName, 'event.manage');
    if (!eventId) throw new AppError(400, 'Select an event.');
    return {
      snapshot:
        (await db.systemSetting.findUnique({ where: { key: `event-close:${eventId}` } }))?.value ??
        null,
      backup:
        (await db.systemSetting.findUnique({ where: { key: `backup-request:${eventId}` } }))
          ?.value ?? null,
    };
  }
  if (view === 'audit') {
    requirePermission(actor.roleName, 'audit.view');
    return db.auditLog.findMany({
      where: {
        ...(eventId ? { eventId } : {}),
        ...(search
          ? {
              OR: [
                { action: { contains: search, mode: 'insensitive' } },
                { entityId: { contains: search } },
                { reason: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }
  if (view === 'promptpay') {
    requirePermission(actor.roleName, 'settings.manage');
    return db.promptPaySetting.findUnique({ where: { id: 'primary' } });
  }
  if (view === 'payments') {
    requirePermission(actor.roleName, 'payment.view');
    if (!eventId) throw new AppError(400, 'Select an event.');
    await requireAssignedEvent(db, actor, eventId);
    return db.payment.findMany({
      where: {
        eventId,
        ...(search
          ? {
              OR: [
                { number: { contains: search, mode: 'insensitive' as const } },
                {
                  account: {
                    registration: { number: { contains: search, mode: 'insensitive' as const } },
                  },
                },
                {
                  account: {
                    registration: {
                      customerName: { contains: search, mode: 'insensitive' as const },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        account: { include: { registration: { select: { number: true, customerName: true } } } },
        station: { select: { code: true } },
        receipt: { select: { id: true, printCount: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  if (view === 'categories') {
    requirePermission(actor.roleName, 'product.view');
    return db.category.findMany({ orderBy: { sortOrder: 'asc' } });
  }
  if (view === 'products') {
    requirePermission(actor.roleName, 'product.view');
    if (eventId) await requireAssignedEvent(db, actor, eventId);
    return db.product.findMany({
      where: actor.roleName === 'SUPER_ADMIN' ? {} : { active: true, category: { active: true } },
      include: { category: true, inventories: { where: { eventId: eventId ?? 'none' } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }
  if (view === 'orders') {
    requirePermission(
      actor.roleName,
      actor.roleName === 'CASHIER' ? 'order.view_own' : 'order.view',
    );
    if (!eventId) throw new AppError(400, 'Select an event.');
    await requireAssignedEvent(db, actor, eventId);
    return db.order.findMany({
      where: {
        eventId,
        ...(actor.roleName === 'CASHIER' ? { userId: actor.id } : {}),
        ...(search
          ? {
              OR: [
                { number: { contains: search, mode: 'insensitive' as const } },
                {
                  account: {
                    registration: { number: { contains: search, mode: 'insensitive' as const } },
                  },
                },
                {
                  account: {
                    registration: {
                      customerName: { contains: search, mode: 'insensitive' as const },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        items: true,
        station: { select: { code: true } },
        account: { include: { registration: { select: { number: true, customerName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  if (view === 'shifts') {
    requirePermission(actor.roleName, 'shift.manage');
    if (eventId) await requireAssignedEvent(db, actor, eventId);
    const selectedEventId =
      actor.roleName === 'SUPER_ADMIN' ? eventId : (await assignedEvent(db, actor)).id;
    const where = {
      ...(selectedEventId ? { eventId: selectedEventId } : {}),
      ...(actor.roleName === 'SUPER_ADMIN' ? {} : { userId: actor.id }),
    };
    const include = {
      station: { select: { code: true } },
      user: { select: { displayName: true } },
    };
    const [open, closed] = await Promise.all([
      db.shift.findMany({
        where: { ...where, closedAt: null },
        include,
        orderBy: { openedAt: 'desc' },
      }),
      db.shift.findMany({
        where: { ...where, closedAt: { not: null } },
        include,
        orderBy: { openedAt: 'desc' },
        take: 100,
      }),
    ]);
    return [...open, ...closed];
  }
  if (view === 'events') {
    requirePermission(actor.roleName, 'event.view');
    const assigned =
      actor.roleName === 'SUPER_ADMIN'
        ? null
        : await db.user.findUniqueOrThrow({
            where: { id: actor.id },
            select: { assignedEventId: true },
          });
    return db.event.findMany({
      where: assigned ? { id: assigned.assignedEventId ?? 'none' } : {},
      orderBy: { createdAt: 'desc' },
    });
  }
  if (view === 'stations') {
    requirePermission(actor.roleName, 'station.view');
    return db.station.findMany({ orderBy: { code: 'asc' } });
  }
  if (view === 'users') {
    requirePermission(actor.roleName, 'user.manage');
    return db.user.findMany({
      where: search
        ? {
            OR: [
              { username: { contains: search, mode: 'insensitive' } },
              { displayName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {},
      select: {
        id: true,
        username: true,
        displayName: true,
        roleName: true,
        active: true,
        assignedEventId: true,
        assignedEvent: { select: { code: true, name: true, status: true } },
      },
      orderBy: { username: 'asc' },
      take: 300,
    });
  }
  if (view === 'settings') {
    requirePermission(actor.roleName, 'settings.manage');
    return {
      ...receiptLayout(
        (await db.systemSetting.findUnique({ where: { key: 'receipt-layout' } }))?.value,
      ),
      organization:
        (await db.systemSetting.findUnique({ where: { key: 'organization' } }))?.value ??
        'ทัณฑสถานบำบัดพิเศษกลาง',
    };
  }
  if (view === 'registrations') {
    requirePermission(actor.roleName, 'registration.view');
    if (!eventId) throw new AppError(400, 'Select an event.');
    await requireAssignedEvent(db, actor, eventId);
    return db.registration.findMany({
      where: {
        eventId,
        ...(customerType === 'all' ? {} : { isVip: customerType === 'vip' }),
        ...(search
          ? {
              OR: [
                { customerName: { contains: search, mode: 'insensitive' } },
                { number: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { account: { include: { credentials: { orderBy: { issuedAt: 'desc' } } } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
  throw new AppError(404, 'Unknown data view.');
}
