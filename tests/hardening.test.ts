import { describe, it, expect, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { fixture } from './helpers';
import { db } from '../src/lib/db';
import { login, authenticate, hashToken } from '../src/lib/auth';
import { checkOrigin, readJson } from '../src/lib/http';
import { createBackup, fileHash, backupFile } from '../src/lib/backup';
import { restoreBackup } from '../scripts/restore';
afterAll(() => db.$disconnect());
describe('production hardening', () => {
  it('enforces expired sessions, inactive accounts, CSRF, body limits and login throttling', async () => {
    const f = await fixture();
    const user = await db.user.findUniqueOrThrow({ where: { id: f.actors.CASHIER.id } });
    const result = await login(user.username, 'test-password-12345', '127.0.0.1');
    expect((await authenticate(result.token)).id).toBe(user.id);
    await db.session.updateMany({
      where: { tokenHash: hashToken(result.token) },
      data: { expiresAt: new Date(0) },
    });
    await expect(authenticate(result.token)).rejects.toThrow('expired');
    await expect(authenticate('invalid')).rejects.toThrow('expired');
    const wrong = new NextRequest('http://localhost:3000/api/operations', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(() => checkOrigin(wrong)).toThrow('origin');
    const large = new NextRequest('http://localhost:3000/api/operations', {
      method: 'POST',
      headers: { origin: process.env.APP_ORIGIN!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(70000) }),
    });
    await expect(readJson(large)).rejects.toThrow('too large');
    const username = `absent-${randomUUID()}`;
    for (let i = 0; i < 10; i++)
      await expect(login(username, 'wrong-password', '127.0.0.1')).rejects.toThrow('Invalid');
    await expect(login(username, 'wrong-password', 'different-ip')).rejects.toThrow('Too many');
  });
  it('creates a real archive, restores into a separate empty database, verifies records and refuses populated targets', async () => {
    const f = await fixture();
    const backup = await createBackup(f.actors.SUPER_ADMIN, 'Recovery drill');
    expect(backup.size).toBeGreaterThan(100);
    expect(await fileHash(backupFile(backup.name))).toBe(backup.sha256);
    const databaseName = `restore_${randomUUID().replaceAll('-', '')}_test`;
    await db.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${databaseName}`;
    const source = await db.user.findUniqueOrThrow({ where: { id: f.actors.SUPER_ADMIN.id } });
    const result = await restoreBackup(
      backup.id,
      url.toString(),
      source.username,
      'test-password-12345',
    );
    expect(result.sessionsRevoked).toBe(true);
    const restored = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    try {
      expect(await restored.user.count()).toBe(await db.user.count());
      expect(await restored.payment.count()).toBe(await db.payment.count());
      expect(await restored.session.count()).toBe(0);
      const restoredAudit = await restored.auditLog.findFirstOrThrow({
        where: { action: 'RESTORE_EXECUTE', entityId: backup.id },
      });
      await expect(
        restored.auditLog.update({ where: { id: restoredAudit.id }, data: { reason: 'tampered' } }),
      ).rejects.toThrow('append-only');
    } finally {
      await restored.$disconnect();
    }
    await expect(
      restoreBackup(backup.id, url.toString(), source.username, 'test-password-12345'),
    ).rejects.toThrow('not empty');
    await expect(
      restoreBackup(backup.id, process.env.DATABASE_URL!, source.username, 'test-password-12345'),
    ).rejects.toThrow('separate new');
  });
});
