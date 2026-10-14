import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, stat, chmod } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { db, transaction } from './db';
import { audit, type Actor } from './audit';
import { requirePermission, AppError } from './rbac';
export function pgEnvironment(urlValue: string) {
  const url = new URL(urlValue);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('PostgreSQL URL required.');
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: url.searchParams.get('sslmode') ?? 'prefer',
    PGCONNECT_TIMEOUT: '15',
  };
}
export function pgTool(name: string) {
  return process.env.PG_BIN_DIRECTORY
    ? path.join(
        process.env.PG_BIN_DIRECTORY,
        `${name}${process.platform === 'win32' ? '.exe' : ''}`,
      )
    : name;
}
export async function runPg(name: string, args: string[], urlValue: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(pgTool(name), args, {
      env: pgEnvironment(urlValue),
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let failed = false;
    const timeout = setTimeout(() => {
      failed = true;
      child.kill();
      reject(new AppError(503, 'Database utility timed out.'));
    }, 600000);
    child.stderr?.on('data', () => {
      /* Do not print connection or database utility details. */
    });
    child.on('error', () => {
      clearTimeout(timeout);
      reject(
        new AppError(503, 'PostgreSQL backup utility is unavailable. Configure PG_BIN_DIRECTORY.'),
      );
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (failed) return;
      if (code === 0) resolve();
      else
        reject(
          new AppError(
            503,
            `${name} failed. Check the configured database utility version, access and directory permissions.`,
          ),
        );
    });
  });
}
export function backupDirectory() {
  if (!process.env.BACKUP_DIRECTORY) throw new AppError(503, 'BACKUP_DIRECTORY is not configured.');
  return path.resolve(process.env.BACKUP_DIRECTORY);
}
export async function fileHash(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export function backupFile(name: string) {
  if (!/^ccida-[\dTZ-]+-[a-f0-9-]{36}\.dump$/.test(name))
    throw new AppError(400, 'Invalid backup filename.');
  const directory = backupDirectory();
  const target = path.resolve(directory, name);
  if (path.dirname(target) !== directory) throw new AppError(400, 'Invalid backup path.');
  return target;
}
export async function createBackup(actor: Actor, reason: string, eventId?: string) {
  requirePermission(actor.roleName, 'backup.manage');
  const directory = backupDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const name = `ccida-${new Date().toISOString().replace(/[:.]/g, '-')}-${id}.dump`;
  const file = backupFile(name);
  await runPg(
    'pg_dump',
    ['--format=custom', '--no-owner', '--no-privileges', '--file', file],
    process.env.DATABASE_URL!,
  );
  await chmod(file, 0o600);
  const metadata = {
    id,
    name,
    sha256: await fileHash(file),
    size: (await stat(file)).size,
    createdAt: new Date().toISOString(),
    eventId: eventId ?? null,
    reason,
  };
  await transaction(async (tx) => {
    await tx.systemSetting.create({ data: { key: `backup:${id}`, value: metadata } });
    await audit(tx, actor, 'BACKUP_CREATE', 'Backup', id, { eventId, after: metadata, reason });
  });
  return metadata;
}
export async function listBackups(actor: Actor) {
  requirePermission(actor.roleName, 'backup.manage');
  return (
    await db.systemSetting.findMany({
      where: { key: { startsWith: 'backup:' } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    })
  ).map((row) => row.value);
}
