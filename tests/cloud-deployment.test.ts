import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID, createHash } from 'node:crypto';
import { runtimeEnvironment } from '../deploy/render/start.mjs';
import { freshCloudTarget } from '../scripts/setup-cloud';
import { uploadBackup } from '../src/lib/backup-storage';
import { createBackup, ensureBackupFile } from '../src/lib/backup';

const mocks = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn() }));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = mocks.send;
    destroy = mocks.destroy;
  },
  PutObjectCommand: class {
    constructor(public input: object) {}
  },
  HeadObjectCommand: class {
    constructor(public input: object) {}
  },
  GetObjectCommand: class {
    constructor(public input: object) {}
  },
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function storage() {
  vi.stubEnv('BACKUP_S3_ENDPOINT', 'https://storage.example.test');
  vi.stubEnv('BACKUP_S3_BUCKET', 'private-pos-backups');
  vi.stubEnv('BACKUP_S3_ACCESS_KEY_ID', 'test-key');
  vi.stubEnv('BACKUP_S3_SECRET_ACCESS_KEY', 'test-secret');
}

describe('free cloud deployment guards', () => {
  it('uses Render HTTPS, preserves account secrets, and removes owner and bootstrap credentials from child processes', () => {
    const config = {
      RENDER_EXTERNAL_URL: 'https://ccida-pos-example.onrender.com',
      DATABASE_URL: 'postgresql://app:secret@cloud.neon.tech/neondb?sslmode=require',
      BACKUP_DATABASE_URL: 'postgresql://app:secret@direct.neon.tech/neondb?sslmode=require',
      BACKUP_S3_ENDPOINT: 'https://storage.example.test',
      BACKUP_S3_BUCKET: 'private',
      BACKUP_S3_REGION: 'ap-southeast-1',
      BACKUP_S3_ACCESS_KEY_ID: 'test',
      BACKUP_S3_SECRET_ACCESS_KEY: 'secret',
      MIGRATION_DATABASE_URL: 'owner-credentials',
      BOOTSTRAP_PASSWORD: 'bootstrap-secret',
    };
    const env = runtimeEnvironment(config);
    expect(env.APP_ORIGIN).toBe(config.RENDER_EXTERNAL_URL);
    expect(env.COOKIE_SECURE).toBe('true');
    expect(env.MIGRATION_DATABASE_URL).toBeUndefined();
    expect(env.BOOTSTRAP_PASSWORD).toBeUndefined();
    expect(config.MIGRATION_DATABASE_URL).toBe('owner-credentials');
    expect(() => runtimeEnvironment({ ...config, APP_ORIGIN: 'http://local.example' })).toThrow(
      'HTTPS',
    );
    expect(() =>
      runtimeEnvironment({ ...config, DATABASE_URL: 'postgresql://localhost/pos' }),
    ).toThrow('TLS');
    expect(() => runtimeEnvironment({ ...config, BACKUP_S3_BUCKET: '' })).toThrow(
      'BACKUP_S3_BUCKET',
    );
  });

  it('accepts only a direct Neon TLS connection and new administrator credentials for fresh setup', () => {
    const config = {
      MIGRATION_DATABASE_URL:
        'postgresql://owner:secret@ep-fresh.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
      BOOTSTRAP_USERNAME: 'new-admin',
      BOOTSTRAP_PASSWORD: 'new-cloud-password-2026',
    };
    expect(freshCloudTarget(config).hostname).toBe('ep-fresh.ap-southeast-1.aws.neon.tech');
    expect(() => freshCloudTarget({})).toThrow('MIGRATION_DATABASE_URL');
    expect(() =>
      freshCloudTarget({ ...config, MIGRATION_DATABASE_URL: 'postgresql://localhost/ccida' }),
    ).toThrow('Neon');
    expect(() =>
      freshCloudTarget({
        ...config,
        MIGRATION_DATABASE_URL: config.MIGRATION_DATABASE_URL.replace(
          'ep-fresh.',
          'ep-fresh-pooler.',
        ),
      }),
    ).toThrow('unpooled');
    expect(() => freshCloudTarget({ ...config, BOOTSTRAP_PASSWORD: 'short' })).toThrow('14');
  });

  it('fails before pg_dump on ephemeral cloud storage without a durable destination', async () => {
    vi.stubEnv('RENDER', 'true');
    vi.stubEnv('BACKUP_S3_BUCKET', '');
    await expect(
      createBackup({ id: randomUUID(), roleName: 'SUPER_ADMIN' }, 'Cloud test'),
    ).rejects.toThrow('durable');
  });

  it('verifies remote uploads and recovers a checksum-checked archive after the local file is lost', async () => {
    storage();
    const directory = await mkdtemp(path.join(tmpdir(), 'ccida-cloud-test-'));
    if (
      path.dirname(directory) !== path.resolve(tmpdir()) ||
      !path.basename(directory).startsWith('ccida-cloud-test-')
    )
      throw new Error('Unexpected test directory');
    vi.stubEnv('BACKUP_DIRECTORY', directory);
    const bytes = Buffer.from('synthetic PostgreSQL archive for cloud storage checks');
    const name = `ccida-2026-10-29T00-00-00-000Z-${randomUUID()}.dump`;
    const file = path.join(directory, name);
    const metadata = {
      name,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      storage: 's3',
    };
    try {
      await writeFile(file, bytes);
      mocks.send
        .mockImplementationOnce(async (command) => {
          const parts: Buffer[] = [];
          for await (const part of command.input.Body) parts.push(Buffer.from(part));
          expect(Buffer.concat(parts)).toEqual(bytes);
          return {};
        })
        .mockResolvedValueOnce({
          ContentLength: bytes.length,
          Metadata: { sha256: metadata.sha256 },
        });
      await uploadBackup(file, metadata);
      await rm(file);
      mocks.send.mockResolvedValueOnce({ Body: Readable.from([bytes]) });
      expect(await ensureBackupFile(metadata)).toBe(file);
      expect(await readFile(file)).toEqual(bytes);
      await rm(file);
      mocks.send.mockResolvedValueOnce({ Body: Readable.from(['corrupted archive']) });
      await expect(ensureBackupFile(metadata)).rejects.toThrow('checksum mismatch');
      await expect(readFile(file)).rejects.toThrow();
      mocks.send
        .mockImplementationOnce(async (command) => {
          command.input.Body.destroy();
          return {};
        })
        .mockResolvedValueOnce({ ContentLength: 0, Metadata: {} });
      await writeFile(file, bytes);
      await expect(uploadBackup(file, metadata)).rejects.toThrow('verification failed');
      expect(mocks.destroy).toHaveBeenCalled();
    } finally {
      // Remove only the unique temporary directory created by this test.
      await rm(directory, { recursive: true, force: true });
    }
  });
});
