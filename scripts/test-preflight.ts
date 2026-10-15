import { loadTestEnvironment } from './test-database';
import { ensureTestDatabaseReady } from './test-postgres';

async function main() {
  loadTestEnvironment();
  await ensureTestDatabaseReady();
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Test database preflight failed.');
  process.exitCode = 1;
});
