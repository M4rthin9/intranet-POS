import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import { db, transaction } from '../src/lib/db';
import { verifyPassword } from '../src/lib/auth';
import { requirePermission } from '../src/lib/rbac';
import { audit } from '../src/lib/audit';
import { backupFile, runPg, fileHash } from '../src/lib/backup';
export async function restoreBackup(
  id: string,
  targetUrl: string,
  username: string,
  password: string,
) {
  const actor = await db.user.findUnique({ where: { username } });
  if (!actor?.active || !verifyPassword(password, actor.passwordHash))
    throw new Error('Invalid recovery administrator credentials.');
  requirePermission(actor.roleName, 'backup.manage');
  const source = new URL(process.env.DATABASE_URL!);
  const target = new URL(targetUrl);
  if (source.pathname === target.pathname)
    throw new Error('Restore must target a separate new database name.');
  const metadata = (await db.systemSetting.findUniqueOrThrow({ where: { key: `backup:${id}` } }))
    .value as { name: string; sha256: string };
  const file = backupFile(metadata.name);
  if ((await fileHash(file)) !== metadata.sha256) throw new Error('Backup checksum mismatch.');
  const restored = new PrismaClient({ datasources: { db: { url: targetUrl } } });
  try {
    const tables = await restored.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT COUNT(*) AS count FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%' AND c.relkind IN ('r','p','v','m','S','f')`;
    if (Number(tables[0].count) !== 0)
      throw new Error('Restore target is not empty. Refusing to overwrite data.');
    await runPg(
      'pg_restore',
      [
        '--single-transaction',
        '--exit-on-error',
        '--no-owner',
        '--no-privileges',
        '--dbname',
        decodeURIComponent(target.pathname.slice(1)),
        file,
      ],
      targetUrl,
    );
    await restored.session.deleteMany();
    const details = {
      backupId: id,
      targetDatabase: decodeURIComponent(target.pathname.slice(1)),
      sessionsRevoked: true,
    };
    await transaction((tx) =>
      audit(tx, { id: actor.id, roleName: actor.roleName }, 'RESTORE_EXECUTE', 'Backup', id, {
        after: details,
        reason: 'Authorized recovery into an empty separate database',
      }),
    );
    await restored.$transaction((tx) =>
      audit(tx, { id: actor.id, roleName: actor.roleName }, 'RESTORE_EXECUTE', 'Backup', id, {
        after: details,
        reason: 'Restored database activated for verification',
      }),
    );
    return details;
  } finally {
    await restored.$disconnect();
  }
}
async function main() {
  if (
    !process.env.RESTORE_DATABASE_URL ||
    !process.env.RESTORE_ADMIN_USERNAME ||
    !process.env.RESTORE_ADMIN_PASSWORD ||
    !process.argv[2]
  )
    throw new Error(
      'Provide backup ID, RESTORE_DATABASE_URL, RESTORE_ADMIN_USERNAME and RESTORE_ADMIN_PASSWORD via environment.',
    );
  await restoreBackup(
    process.argv[2],
    process.env.RESTORE_DATABASE_URL,
    process.env.RESTORE_ADMIN_USERNAME,
    process.env.RESTORE_ADMIN_PASSWORD,
  );
  console.log(
    'Restore completed into a new empty database. Reconcile before switching production configuration.',
  );
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/restore.ts'))
  main().finally(() => db.$disconnect());
