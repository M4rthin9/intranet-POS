import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { Prisma } from '@prisma/client';
import { db } from '../src/lib/db';
import { errorResponse } from '../src/lib/http';
import { AppError } from '../src/lib/rbac';
import { ensureTestDatabaseReady } from '../scripts/test-postgres';
import { testPort } from '../scripts/test-port';
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    throw new Error('Unexpected process launch in database preflight guard test.');
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
afterAll(() => db.$disconnect());
describe('database outage recovery', () => {
  it('explains login database failures without exposing credentials and retains financial safe-retry semantics', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Prisma.PrismaClientInitializationError(
      'postgresql://user:very-secret@internal/database',
      '6.19.3',
      'P1001',
    );
    const response = errorResponse(failure, 'login');
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.has('set-cookie')).toBe(false);
    const body = await response.text();
    expect(body).toContain('DATABASE_UNAVAILABLE');
    expect(body).toContain('Retry sign-in');
    expect(body).not.toContain('very-secret');
    const implicit = errorResponse(
      new Prisma.PrismaClientInitializationError('private database details', '6.19.3'),
      'login',
    );
    expect(implicit.status).toBe(503);
    expect((await implicit.json()).code).toBe('DATABASE_UNAVAILABLE');
    expect(JSON.stringify(logged.mock.calls)).not.toContain('very-secret');
    const financial = errorResponse(failure);
    expect(financial.status).toBe(503);
    expect((await financial.json()).error).toContain('Keep the current request and retry safely');
    expect(errorResponse(new AppError(401, 'Invalid username or password.'), 'login').status).toBe(
      401,
    );
    expect(
      errorResponse(
        new Prisma.PrismaClientKnownRequestError('Duplicate', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      ).status,
    ).toBe(409);
  });

  it('checks authenticated database readiness without launching processes or changing records', async () => {
    const processes = vi.mocked(spawn);
    const count = await db.user.count();
    const log = vi.fn();
    await ensureTestDatabaseReady({ log, timeoutMs: 10000 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Database ready:'));
    expect(processes).not.toHaveBeenCalled();
    expect(await db.user.count()).toBe(count);
  });

  it('rejects runtime databases and never starts PostgreSQL for an unavailable foreign endpoint', async () => {
    const processes = vi.mocked(spawn);
    vi.stubEnv('TEST_DATABASE_URL', 'postgresql://127.0.0.1/in-pos');
    await expect(ensureTestDatabaseReady()).rejects.toThrow('ending in _test');
    const port = await testPort();
    vi.stubEnv('TEST_DATABASE_URL', `postgresql://unavailable@127.0.0.1:${port}/unavailable_test`);
    await expect(ensureTestDatabaseReady({ timeoutMs: 0, log: vi.fn() })).rejects.toThrow(
      'not ready',
    );
    expect(processes).not.toHaveBeenCalled();
  });
});
