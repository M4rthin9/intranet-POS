import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { loadTestEnvironment } from './test-database';
import { ensureDatabaseReady } from './test-postgres';

async function main() {
  const runtime = process.argv.includes('--runtime');
  if (runtime) config({ quiet: true });
  else loadTestEnvironment();
  const origin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000');
  const port = Number(
    process.env.PORT ?? (origin.port || (origin.protocol === 'https:' ? 443 : 80)),
  );
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be between 1 and 65535.');
  if (Number(origin.port || (origin.protocol === 'https:' ? 443 : 80)) !== port)
    throw new Error('APP_ORIGIN and PORT must identify the same application port.');
  process.env.APP_ORIGIN = origin.origin;
  console.log(`${runtime ? 'OPERATIONAL' : 'TEST'} MODE; app origin ${origin.origin}`);
  await ensureDatabaseReady(process.env.DATABASE_URL);
  const child = spawn(
    process.execPath,
    [
      resolve('node_modules/next/dist/bin/next'),
      'dev',
      '--hostname',
      '0.0.0.0',
      '--port',
      String(port),
    ],
    {
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  child.once('error', () => {
    console.error('Could not start Next.js. Check Node.js and installed dependencies.');
    process.exitCode = 1;
  });
  child.once('exit', (code) => {
    process.exitCode = code ?? 1;
  });
  process.once('SIGINT', () => {
    child.kill('SIGINT');
  });
  process.once('SIGTERM', () => {
    child.kill('SIGTERM');
  });
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Test server configuration is invalid.');
  process.exitCode = 1;
});
