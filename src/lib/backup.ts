import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, stat, chmod, rename, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { db, transaction } from './db';
import { audit, type Actor } from './audit';
import { requirePermission, AppError } from './rbac';
import { uploadBackup, downloadBackup } from './backup-storage';
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
export async function ensureBackupFile(metadata: {
  name: string;
  sha256?: string;
  storage?: string;
}) {
  const file = backupFile(metadata.name);
  if (metadata.storage !== 's3') return file;
  if (!metadata.sha256) throw new AppError(503, 'Cloud archive checksum is missing.');
  try {
    if ((await fileHash(file)) === metadata.sha256) return file;
  } catch {
    /* A sleeping cloud host loses its local cache. */
  }
  await mkdir(backupDirectory(), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await downloadBackup(metadata.name, temporary);
    if ((await fileHash(temporary)) !== metadata.sha256)
      throw new AppError(503, 'Cloud backup checksum mismatch.');
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  return file;
}
export async function createBackup(actor: Actor, reason: string, eventId?: string) {
  requirePermission(actor.roleName, 'backup.manage');
  if (process.env.RENDER && !process.env.BACKUP_S3_BUCKET)
    throw new AppError(503, 'Configure durable cloud backup storage before creating backups.');
  const directory = backupDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const name = `ccida-${new Date().toISOString().replace(/[:.]/g, '-')}-${id}.dump`;
  const file = backupFile(name);
  await runPg(
    'pg_dump',
    ['--format=custom', '--no-owner', '--no-privileges', '--file', file],
    process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL!,
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
    ...(process.env.BACKUP_S3_BUCKET ? { storage: 's3' as const } : {}),
  };
  if (metadata.storage === 's3') await uploadBackup(file, metadata);
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
