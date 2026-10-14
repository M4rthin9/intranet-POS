import { z } from 'zod';
import { hashPassword } from './auth';
import { transaction } from './db';
import { audit, type Actor } from './audit';
import { requirePermission, AppError } from './rbac';
export async function manage(actor: Actor, action: string, input: unknown) {
  if (action === 'backup.schedule') {
    requirePermission(actor.roleName, 'backup.manage');
    const data = z
      .object({ enabled: z.boolean(), intervalHours: z.number().int().min(1).max(168) })
      .parse(input);
    return transaction(async (tx) => {
      const before = await tx.systemSetting.findUnique({ where: { key: 'backup-schedule' } });
      const value = { ...((before?.value as Record<string, unknown>) ?? {}), ...data };
      const result = await tx.systemSetting.upsert({
        where: { key: 'backup-schedule' },
        create: { key: 'backup-schedule', value },
        update: { value },
      });
      await audit(tx, actor, 'SETTINGS_UPDATE', 'SystemSetting', 'backup-schedule', {
        before: before?.value,
        after: value,
      });
      return result;
    });
  }
  if (action === 'user.save') {
    requirePermission(actor.roleName, 'user.manage');
    const data = z
      .object({
        id: z.string().optional(),
        username: z
          .string()
          .min(3)
          .max(80)
          .regex(/^[a-zA-Z0-9_.-]+$/),
        displayName: z.string().min(1).max(120),
        roleName: z.enum(['SUPER_ADMIN', 'ADMIN', 'CASHIER', 'PAYMENT_CASHIER']),
        password: z.string().min(14).max(256).optional(),
        active: z.boolean().default(true),
      })
      .parse(input);
    return transaction(async (tx) => {
      const before = data.id ? await tx.user.findUniqueOrThrow({ where: { id: data.id } }) : null;
      if (!before && !data.password)
        throw new AppError(400, 'A password is required for a new user.');
      if (
        before?.roleName === 'SUPER_ADMIN' &&
        (!data.active || data.roleName !== 'SUPER_ADMIN') &&
        (await tx.user.count({ where: { roleName: 'SUPER_ADMIN', active: true } })) <= 1
      )
        throw new AppError(409, 'The last active super administrator cannot be disabled.');
      const fields = {
        username: data.username,
        displayName: data.displayName,
        roleName: data.roleName,
        active: data.active,
        ...(data.password ? { passwordHash: hashPassword(data.password) } : {}),
      };
      const user = before
        ? await tx.user.update({ where: { id: before.id }, data: fields })
        : await tx.user.create({ data: { ...fields, passwordHash: fields.passwordHash! } });
      if (before && (data.password || !data.active || before.roleName !== data.roleName))
        await tx.session.deleteMany({ where: { userId: user.id } });
      const safe = {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        roleName: user.roleName,
        active: user.active,
      };
      await audit(
        tx,
        actor,
        !user.active ? 'USER_DISABLE' : before ? 'USER_UPDATE' : 'USER_CREATE',
        'User',
        user.id,
        {
          before: before
            ? { username: before.username, roleName: before.roleName, active: before.active }
            : undefined,
          after: safe,
        },
      );
      return safe;
    });
  }
  if (action === 'station.save') {
    requirePermission(actor.roleName, 'station.manage');
    const data = z
      .object({
        id: z.string().optional(),
        code: z.string().min(1).max(40),
        name: z.string().min(1).max(100),
        type: z.enum(['REGISTRATION', 'POS', 'PAYMENT', 'ADMIN']),
        active: z.boolean().default(true),
      })
      .parse(input);
    return transaction(async (tx) => {
      const before = data.id
        ? await tx.station.findUniqueOrThrow({ where: { id: data.id } })
        : null;
      if (
        before &&
        (before.type !== data.type || !data.active) &&
        (await tx.shift.count({ where: { stationId: before.id, closedAt: null } }))
      )
        throw new AppError(409, 'Close station shifts before changing type or disabling it.');
      const { id, ...fields } = data;
      const value = id
        ? await tx.station.update({ where: { id }, data: fields })
        : await tx.station.create({ data: fields });
      await audit(tx, actor, before ? 'STATION_UPDATE' : 'STATION_CREATE', 'Station', value.id, {
        before,
        after: value,
      });
      return value;
    });
  }
  if (action === 'settings.save') {
    requirePermission(actor.roleName, 'settings.manage');
    const data = z.object({ organization: z.string().min(1).max(200) }).parse(input);
    return transaction(async (tx) => {
      const before = await tx.systemSetting.findUnique({ where: { key: 'organization' } });
      const value = await tx.systemSetting.upsert({
        where: { key: 'organization' },
        create: { key: 'organization', value: data.organization },
        update: { value: data.organization },
      });
      await audit(tx, actor, 'SETTINGS_UPDATE', 'SystemSetting', 'organization', {
        before,
        after: value,
      });
      return value;
    });
  }
  throw new AppError(404, 'Unknown operation.');
}
