import { PrismaClient } from '@prisma/client';
import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { createConnection } from 'node:net';
import path from 'node:path';
import { assertTestSeedTarget } from './test-database';
import { databaseUnavailableCode } from '../src/lib/database-errors';

const transientCodes = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
  'P2037',
  '57P01',
  '57P03',
  '08001',
  '08006',
]);
function run(binary: string, args: string[], detached = false) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      detached,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    child.stderr.on('data', (data) => {
      output += data.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, output }));
  });
}
function listening(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}
async function startOwnedCluster(
  target: ReturnType<typeof assertTestSeedTarget>,
  log: (message: string) => void,
) {
  if (
    process.platform !== 'win32' ||
    !['127.0.0.1', 'localhost'].includes(target.host) ||
    target.port !== '55432'
  )
    return false;
  const workspace = await realpath(process.cwd());
  let cluster: string;
  let major: string;
  try {
    cluster = await realpath(path.join(workspace, '.local', 'postgres'));
    if (!cluster.toLowerCase().startsWith((workspace + path.sep).toLowerCase())) return false;
    major = (await readFile(path.join(cluster, 'PG_VERSION'), 'utf8')).trim();
  } catch {
    return false;
  }
  if (!process.env.PG_BIN_DIRECTORY)
    throw new Error(
      'Set PG_BIN_DIRECTORY to the installed PostgreSQL tools before starting the local test database.',
    );
  const pgCtl = path.resolve(process.env.PG_BIN_DIRECTORY, 'pg_ctl.exe');
  const version = await run(pgCtl, ['--version']);
  if (version.code !== 0 || version.output.match(/PostgreSQL\) (\d+)/)?.[1] !== major)
    throw new Error(
      'PostgreSQL tools do not match the existing test cluster version. No database files were changed.',
    );
  const status = await run(pgCtl, ['-D', cluster, 'status']);
  if (status.code === 0) {
    log('Workspace PostgreSQL is running; waiting for database readiness.');
    return true;
  }
  log('Starting the existing workspace PostgreSQL cluster on 127.0.0.1:55432.');
  // A hidden detached launcher prevents closing the dev console from killing PostgreSQL.
  const started = await run(
    pgCtl,
    [
      '-D',
      cluster,
      '-l',
      path.join(workspace, '.local', 'postgres.log'),
      '-o',
      '-p 55432 -h 127.0.0.1',
      '-W',
      'start',
    ],
    true,
  );
  if (started.code !== 0 && (await run(pgCtl, ['-D', cluster, 'status'])).code !== 0)
    throw new Error(
      'The workspace test database could not start. Inspect .local/postgres.log; no reset or initialization was attempted.',
    );
  return true;
}
export async function ensureTestDatabaseReady(
  options: { autoStart?: boolean; timeoutMs?: number; log?: (message: string) => void } = {},
) {
  const target = assertTestSeedTarget(process.env.TEST_DATABASE_URL);
  const log = options.log ?? console.log;
  const probeUrl = new URL(process.env.TEST_DATABASE_URL!);
  probeUrl.searchParams.set('connect_timeout', '2');
  probeUrl.searchParams.set('connection_limit', '1');
  const deadline = Date.now() + (options.timeoutMs ?? 180000);
  let startedOwned = false;
  let checkedStartup = false;
  let lastLog = 0;
  for (;;) {
    const probe = new PrismaClient({ datasourceUrl: probeUrl.toString(), log: [] });
    let code: string | undefined;
    try {
      await probe.$connect();
      await probe.$queryRaw`SELECT 1`;
      log(`Database ready: ${target.database} at ${target.host}:${target.port}.`);
      return;
    } catch (error) {
      code = databaseUnavailableCode(error);
      if (!code || !transientCodes.has(code))
        throw new Error(
          `Test database preflight failed (${code ?? 'configuration/schema error'}). Check .env.test credentials, database and schema. No data was changed.`,
          { cause: error },
        );
    } finally {
      await probe.$disconnect();
    }
    if (options.autoStart !== false && !checkedStartup) {
      checkedStartup = true;
      if (!(await listening(target.host, Number(target.port))))
        startedOwned = await startOwnedCluster(target, log);
    }
    if (Date.now() >= deadline)
      throw new Error(
        `Test database is not ready (${code}). ${startedOwned ? 'PostgreSQL may still be recovering; inspect .local/postgres.log and retry without resetting data.' : 'Start the configured database and retry.'}`,
      );
    if (Date.now() - lastLog >= 10000) {
      log(
        'Waiting for the test database to accept authenticated connections; Next.js has not started yet.',
      );
      lastLog = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
