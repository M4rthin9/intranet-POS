import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function runtimeEnvironment(config) {
  const origin = new URL(config.APP_ORIGIN || config.RENDER_EXTERNAL_URL || 'http://invalid');
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('Set APP_ORIGIN to the public HTTPS origin without a path or credentials.');
  for (const key of [
    'DATABASE_URL',
    'BACKUP_DATABASE_URL',
    'BACKUP_S3_ENDPOINT',
    'BACKUP_S3_BUCKET',
    'BACKUP_S3_REGION',
    'BACKUP_S3_ACCESS_KEY_ID',
    'BACKUP_S3_SECRET_ACCESS_KEY',
  ])
    if (!config[key]) throw new Error(`Configure ${key} securely before starting the cloud POS.`);
  for (const key of ['DATABASE_URL', 'BACKUP_DATABASE_URL']) {
    const database = new URL(config[key]);
    if (
      !['postgres:', 'postgresql:'].includes(database.protocol) ||
      ['localhost', '127.0.0.1', '::1', '[::1]'].includes(database.hostname) ||
      !['require', 'verify-ca', 'verify-full'].includes(database.searchParams.get('sslmode') ?? '')
    )
      throw new Error(`${key} must be a cloud PostgreSQL connection using TLS.`);
  }
  if (new URL(config.BACKUP_S3_ENDPOINT).protocol !== 'https:')
    throw new Error('Cloud backup storage requires HTTPS.');
  const env = {
    ...config,
    APP_ORIGIN: origin.origin,
    COOKIE_SECURE: 'true',
    HOSTNAME: '0.0.0.0',
    PORT: config.PORT || '10000',
  };
  for (const key of [
    'MIGRATION_DATABASE_URL',
    'CLOUD_DATABASE_URL',
    'SOURCE_DATABASE_URL',
    'BOOTSTRAP_USERNAME',
    'BOOTSTRAP_PASSWORD',
  ])
    delete env[key];
  return env;
}

function start() {
  const env = runtimeEnvironment(process.env);
  const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const app = spawn(process.execPath, ['.next/standalone/server.js'], {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  const worker = spawn(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'scripts/backup-worker.ts'],
    { cwd: root, env, stdio: 'inherit', windowsHide: true },
  );
  let stopping = false;
  function stop(code) {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    app.kill('SIGTERM');
    worker.kill('SIGTERM');
    setTimeout(() => {
      app.kill('SIGKILL');
      worker.kill('SIGKILL');
    }, 10000).unref();
  }
  for (const child of [app, worker]) {
    child.once('error', () => {
      console.error('A cloud POS process could not start.');
      stop(1);
    });
    child.once('exit', (code) => stop(code ?? 1));
  }
  process.once('SIGTERM', () => stop(0));
  process.once('SIGINT', () => stop(0));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    start();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
