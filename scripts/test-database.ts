import { config } from 'dotenv';

export function assertTestSeedTarget(connection: string | undefined) {
  if (process.env.NODE_ENV === 'production')
    throw new Error(
      'Test seeding/startup is disabled in production. Use production configuration.',
    );
  if (!connection) throw new Error('Configure TEST_DATABASE_URL in .env.test first.');
  let target: URL;
  try {
    target = new URL(connection);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !/^\/[A-Za-z0-9_-]+_test$/.test(decodeURIComponent(target.pathname))
  )
    throw new Error(
      'Test configuration requires a PostgreSQL database name ending in _test. No data was changed.',
    );
  return { host: target.hostname, port: target.port || '5432', database: target.pathname.slice(1) };
}

export function loadTestEnvironment() {
  config({ path: '.env.test', override: true, quiet: true });
  config({ quiet: true });
  const target = assertTestSeedTarget(process.env.TEST_DATABASE_URL);
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL!;
  return target;
}
