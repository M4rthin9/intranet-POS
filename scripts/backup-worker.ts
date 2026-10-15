import 'dotenv/config';
import { db, transaction } from '../src/lib/db';
import { createBackup } from '../src/lib/backup';
const once = process.argv.includes('--once');
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
async function tick() {
  const actor = await db.user.findFirst({
    where: { roleName: 'SUPER_ADMIN', active: true },
    select: { id: true, roleName: true },
  });
  if (!actor) return;
  const requests = await db.systemSetting.findMany({
    where: { key: { startsWith: 'backup-request:' } },
  });
  for (const request of requests) {
    const data = request.value as {
      status: string;
      eventId: string;
      startedAt?: string;
      nextAttemptAt?: string;
    };
    if (
      data.status !== 'PENDING' &&
      !(
        data.status === 'PROCESSING' &&
        data.startedAt &&
        Date.now() - new Date(data.startedAt).getTime() > 900000
      )
    )
      continue;
    if (data.nextAttemptAt && Date.now() < new Date(data.nextAttemptAt).getTime()) continue;
    const startedAt = new Date().toISOString();
    const claim = await db.systemSetting.updateMany({
      where: { key: request.key, updatedAt: request.updatedAt, value: { equals: data } },
      data: { value: { ...data, status: 'PROCESSING', startedAt } },
    });
    if (!claim.count) continue;
    try {
      const backup = await createBackup(actor, 'Event closing backup', data.eventId);
      await transaction((tx) =>
        tx.systemSetting.updateMany({
          where: { key: request.key, value: { path: ['startedAt'], equals: startedAt } },
          data: {
            value: {
              ...data,
              status: 'COMPLETE',
              backupId: backup.id,
              completedAt: backup.createdAt,
            },
          },
        }),
      );
    } catch (error) {
      if (once) process.exitCode = 1;
      await db.systemSetting.updateMany({
        where: { key: request.key, value: { path: ['startedAt'], equals: startedAt } },
        data: {
          value: {
            ...data,
            status: 'PENDING',
            nextAttemptAt: new Date(Date.now() + 300000).toISOString(),
          },
        },
      });
      console.error(
        'Closing backup failed:',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }
  const setting = await db.systemSetting.findUnique({ where: { key: 'backup-schedule' } });
  const schedule = setting?.value as
    | { enabled: boolean; intervalHours: number; lastAt?: string; lastAttemptAt?: string }
    | undefined;
  const hours = schedule?.intervalHours ?? 24;
  if (
    schedule?.enabled &&
    (!schedule.lastAt || Date.now() - new Date(schedule.lastAt).getTime() > hours * 3600000) &&
    (!schedule.lastAttemptAt || Date.now() - new Date(schedule.lastAttemptAt).getTime() > 900000)
  ) {
    const claim = await db.systemSetting.updateMany({
      where: { key: 'backup-schedule', updatedAt: setting!.updatedAt, value: { equals: schedule } },
      data: { value: { ...schedule, lastAttemptAt: new Date().toISOString() } },
    });
    if (!claim.count) return;
    const backup = await createBackup(actor, 'Scheduled backup');
    // Preserve any schedule edits made while pg_dump was running.
    await db.$executeRaw`UPDATE "SystemSetting" SET "value"=jsonb_set("value",'{lastAt}',to_jsonb(${backup.createdAt}::text),true), "updatedAt"=clock_timestamp() WHERE "key"='backup-schedule'`;
  }
}
async function main() {
  do {
    try {
      await tick();
    } catch (error) {
      if (once) process.exitCode = 1;
      console.error('Backup worker failed:', error instanceof Error ? error.name : 'Unknown error');
    }
    if (once || stopping) break;
    await new Promise((resolve) => setTimeout(resolve, 30000));
  } while (!stopping);
}
main().finally(() => db.$disconnect());
