import { config } from 'dotenv';
config({ path: '.env.test', override: true, quiet: true });
config({ quiet: true });
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
)
  throw new Error(
    'Integration tests require TEST_DATABASE_URL with a database name ending in _test.',
  );
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
