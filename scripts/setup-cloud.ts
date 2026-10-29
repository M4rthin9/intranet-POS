import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function freshCloudTarget(settings: Record<string, string | undefined>) {
  if (!settings.MIGRATION_DATABASE_URL)
    throw new Error('Set the NEW Neon database connection in MIGRATION_DATABASE_URL.');
  const target = new URL(settings.MIGRATION_DATABASE_URL);
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !target.hostname.endsWith('.neon.tech') ||
    target.hostname.includes('-pooler.') ||
    !['require', 'verify-ca', 'verify-full'].includes(target.searchParams.get('sslmode') ?? '')
  )
    throw new Error('Use a direct, unpooled Neon connection with TLS for fresh cloud setup.');
  if (
    !settings.BOOTSTRAP_USERNAME ||
    !/^[a-zA-Z0-9_.-]{3,80}$/.test(settings.BOOTSTRAP_USERNAME) ||
    !settings.BOOTSTRAP_PASSWORD ||
    settings.BOOTSTRAP_PASSWORD.length < 14 ||
    settings.BOOTSTRAP_PASSWORD.length > 256
  )
    throw new Error(
      'Set a new administrator username and a password of 14–256 characters in the private configuration.',
    );
  return target;
}

async function main() {
  config({ path: '.env.cloud', override: false, quiet: true });
  const target = freshCloudTarget(process.env);
  const database = new PrismaClient({ datasources: { db: { url: target.toString() } } });
  let phase = 'checking the new database';
  try {
    const [{ count }] = await database.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%' AND c.relkind IN ('r','p','v','m','S','f')`;
    if (count !== 0n)
      throw new Error(
        'The destination is not empty. Fresh setup refuses to change an existing database.',
      );
    if (
      (
        await database.$queryRaw<
          { count: bigint }[]
        >`SELECT count(*) FROM pg_roles WHERE rolname='ccida_app'`
      )[0].count !== 0n
    )
      throw new Error(
        'The ccida_app role already exists. Use a new Neon project for this fresh installation.',
      );
    console.log(
      `Fresh database verified: ${target.hostname}. No existing POS database will be read or copied.`,
    );
    const run = (args: string[]) => {
      const result = spawnSync(process.execPath, args, {
        env: { ...process.env, DATABASE_URL: target.toString() },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (result.status !== 0)
        throw new Error(
          `Fresh setup failed while ${phase}. No database was reset; inspect the new database before retrying.`,
        );
    };
    phase = 'creating the application schema';
    run(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
    phase = 'creating the new administrator and empty stations';
    run(['node_modules/tsx/dist/cli.mjs', 'scripts/bootstrap.ts']);
    if (
      (await database.event.count()) ||
      (await database.category.count()) ||
      (await database.product.count()) ||
      (await database.registration.count()) ||
      (await database.order.count()) ||
      (await database.payment.count()) ||
      (await database.user.count()) !== 1
    )
      throw new Error('Fresh database verification failed. The cloud app was not activated.');
    phase = 'preparing separate application credentials';
    const password = randomBytes(32).toString('base64url');
    const direct = new URL(target);
    direct.username = 'ccida_app';
    direct.password = password;
    const pooled = new URL(direct);
    pooled.hostname = pooled.hostname.replace(/^(ep-[^.]+)\./, '$1-pooler.');
    pooled.searchParams.set('connection_limit', '2');
    pooled.searchParams.set('pool_timeout', '30');
    pooled.searchParams.set('connect_timeout', '30');
    const environment: Record<string, string> = {
      DATABASE_URL: pooled.toString(),
      BACKUP_DATABASE_URL: direct.toString(),
    };
    for (const key of [
      'BACKUP_S3_ENDPOINT',
      'BACKUP_S3_BUCKET',
      'BACKUP_S3_REGION',
      'BACKUP_S3_ACCESS_KEY_ID',
      'BACKUP_S3_SECRET_ACCESS_KEY',
    ])
      if (process.env[key]) environment[key] = process.env[key]!;
    const directory = path.resolve('.local/credentials');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const environmentFile = path.join(directory, `render-fresh-${randomUUID()}.json`);
    // Save generated credentials before creating the role, including on partial failure.
    await writeFile(environmentFile, JSON.stringify(environment, null, 2), {
      flag: 'wx',
      mode: 0o600,
    });
    console.log(
      `Private Render environment saved to ${environmentFile}. It contains no owner or administrator password.`,
    );
    // The generated password uses only base64url characters, so it cannot inject SQL.
    await database.$executeRawUnsafe(
      `CREATE ROLE ccida_app LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`,
    );
    const [{ owner, name }] = await database.$queryRaw<
      { owner: string; name: string }[]
    >`SELECT current_user AS owner, current_database() AS name`;
    const identifier = (value: string) => '"' + value.replaceAll('"', '""') + '"';
    for (const sql of [
      `GRANT CONNECT ON DATABASE ${identifier(name)} TO ccida_app`,
      'GRANT USAGE ON SCHEMA public TO ccida_app',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ccida_app',
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ccida_app',
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${identifier(owner)} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ccida_app`,
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${identifier(owner)} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ccida_app`,
    ])
      await database.$executeRawUnsafe(sql);
    const app = new PrismaClient({ datasources: { db: { url: direct.toString() } } });
    try {
      if ((await app.user.count()) !== 1 || (await app.order.count()) !== 0)
        throw new Error('Application database access verification failed.');
    } finally {
      await app.$disconnect();
    }
    console.log(
      'Fresh cloud setup complete: one new administrator, empty stations, no events, products, customers or transactions. Local data was not accessed.',
    );
  } catch (error) {
    console.error(
      `Fresh cloud setup stopped while ${phase}. Local databases were not accessed and no database was reset.`,
    );
    if (error instanceof Error && !('code' in error)) console.error(error.message);
    process.exitCode = 1;
  } finally {
    await database.$disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch(() => {
    console.error(
      'Fresh cloud setup could not start. Check the private Neon connection and new administrator configuration.',
    );
    process.exitCode = 1;
  });
