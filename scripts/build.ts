import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

async function run(script: string, args: string[]) {
  await new Promise<void>((done, reject) => {
    const child = spawn(process.execPath, [resolve(script), ...args], {
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? done() : reject(new Error(`Build step failed with exit code ${code}.`)),
    );
  });
}

async function currentClientMatches() {
  try {
    const [source, generated, sdk, client, files] = await Promise.all([
      readFile('prisma/schema.prisma', 'utf8'),
      readFile('node_modules/.prisma/client/schema.prisma', 'utf8'),
      readFile('node_modules/@prisma/client/package.json', 'utf8'),
      readFile('node_modules/.prisma/client/package.json', 'utf8'),
      readdir('node_modules/.prisma/client'),
    ]);
    const engine =
      process.platform === 'win32'
        ? files.includes('query_engine-windows.dll.node')
        : files.some(
            (file) =>
              /^libquery_engine-/.test(file) &&
              file.endsWith(process.platform === 'darwin' ? '.dylib.node' : '.so.node'),
          );
    return (
      source === generated &&
      JSON.parse(sdk).version === JSON.parse(client).version &&
      engine &&
      files.includes('index.js') &&
      files.includes('index.d.ts')
    );
  } catch {
    return false;
  }
}

async function main() {
  if (await currentClientMatches())
    console.log('Prisma schema and SDK match the generated client; reusing it.');
  else await run('node_modules/prisma/build/index.js', ['generate']);
  await run('node_modules/next/dist/bin/next', ['build', '--webpack']);
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Build failed.');
  process.exitCode = 1;
});
