import '../tests/setup';
import { spawnSync } from 'node:child_process';
import { assertTestSeedTarget } from './test-database';
assertTestSeedTarget(process.env.DATABASE_URL);
const result = spawnSync(
  process.execPath,
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  {
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  },
);
process.exitCode = result.status ?? 1;
