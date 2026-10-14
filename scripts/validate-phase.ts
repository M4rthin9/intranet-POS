import 'dotenv/config';
import { config } from 'dotenv';
if (process.argv.includes('--isolated')) config({ path: '.env.test', override: true, quiet: true });
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const phase = Number(process.argv[2]);
if (!Number.isInteger(phase) || phase < 1 || phase > 8)
  throw new Error('Supply a phase number 1–8.');
const results: string[] = [];
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script through npm run validate:phase.');
for (const task of ['db:check', 'lint', 'typecheck', 'test', 'build']) {
  const start = Date.now();
  const result = spawnSync(process.execPath, [npmCli, 'run', task], {
    stdio: 'pipe',
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  const log = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  mkdirSync(`docs/validation/phase-${phase}`, { recursive: true });
  writeFileSync(`docs/validation/phase-${phase}/${task.replace(':', '-')}.log`, log);
  console.log(
    `${task}: ${result.status === 0 ? 'PASS' : 'FAIL'} (${Math.round((Date.now() - start) / 1000)}s)`,
  );
  results.push(`| ${task} | ${result.status === 0 ? 'PASS' : 'FAIL'} |`);
  if (result.status !== 0) {
    console.log(log);
    process.exitCode = 1;
    break;
  }
}
writeFileSync(
  `docs/validation/phase-${phase}/results.md`,
  `# Phase ${phase} validation\n\nDate: ${new Date().toISOString()}\n\n| Check | Result |\n|---|---|\n${results.join('\n')}\n`,
);
