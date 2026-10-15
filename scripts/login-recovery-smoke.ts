import '../tests/setup';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';
import { testPort } from './test-port';

async function stop(server?: ChildProcess) {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, 'exit');
  server.kill();
  await exited;
}
async function main() {
  const port = await testPort();
  let unavailablePort = await testPort();
  while (unavailablePort === port) unavailablePort = await testPort();
  const origin = `http://127.0.0.1:${port}`;
  const directory = 'docs/validation/login-recovery';
  await mkdir(directory, { recursive: true });
  const password = 'test-login-recovery-12345';
  const user = await db.user.create({
    data: {
      username: `login-recovery-${randomUUID().slice(0, 8)}`,
      displayName: 'Login recovery acceptance',
      roleName: 'CASHIER',
      passwordHash: hashPassword(password),
    },
  });
  let server: ChildProcess | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let serverOutput = '';
  async function start(connection: string) {
    server = spawn(
      process.execPath,
      [
        path.resolve('node_modules/next/dist/bin/next'),
        'start',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(port),
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: connection,
          APP_ORIGIN: origin,
          COOKIE_SECURE: 'false',
          NEXT_TELEMETRY_DISABLED: '1',
        },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    server.stdout?.on('data', (data) => {
      serverOutput += data.toString();
    });
    server.stderr?.on('data', (data) => {
      serverOutput += data.toString();
    });
    for (let attempt = 0; attempt < 120; attempt++) {
      if (server.exitCode !== null)
        throw new Error('Owned login acceptance server exited before startup.');
      try {
        if (
          (await fetch(origin + '/api/auth', { signal: AbortSignal.timeout(1500) })).status === 401
        )
          return;
      } catch {
        /* Wait for this owned application's listener. */
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Owned login acceptance server did not start.');
  }
  try {
    await start(
      `postgresql://unavailable@127.0.0.1:${unavailablePort}/unavailable_test?connect_timeout=1`,
    );
    browser = await chromium.launch({
      executablePath:
        process.env.BROWSER_EXECUTABLE ??
        (process.platform === 'win32'
          ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
          : undefined),
      headless: true,
    });
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    await page.locator('input[name="username"]').fill(user.username);
    await page.locator('input[name="password"]').fill(password);
    const rejected = page.waitForResponse(
      (response) => response.url().endsWith('/api/auth') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'เข้าสู่ระบบ →', exact: true }).click();
    const outage = await rejected;
    assert.equal(outage.status(), 503);
    assert.equal((await outage.json()).code, 'DATABASE_UNAVAILABLE');
    assert.equal(outage.headers()['retry-after'], '5');
    assert.ok(!outage.headers()['set-cookie']);
    await page.getByRole('alert').getByText('Database unavailable.', { exact: false }).waitFor();
    assert.equal(await page.locator('input[name="username"]').inputValue(), user.username);
    assert.equal(await page.locator('input[name="password"]').inputValue(), password);
    assert.equal(
      await page.evaluate(
        (secret) => Object.values(sessionStorage).some((value) => value.includes(secret)),
        password,
      ),
      false,
    );
    await page.screenshot({ path: `${directory}/login-unavailable.png`, fullPage: true });
    console.log(
      'PASS Unavailable database gives login 503, no session cookie, clear error and retained fields.',
    );
    await stop(server);
    server = undefined;
    await start(process.env.TEST_DATABASE_URL!);
    const accepted = page.waitForResponse(
      (response) => response.url().endsWith('/api/auth') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'เข้าสู่ระบบ →', exact: true }).click();
    assert.equal((await accepted).status(), 200);
    await page.waitForURL(origin + '/pos');
    await page.locator('.workspace').waitFor();
    assert.equal(await page.locator('nav button').count(), 1);
    assert.equal(await db.session.count({ where: { userId: user.id } }), 1);
    assert.equal(await db.auditLog.count({ where: { actorUserId: user.id, action: 'LOGIN' } }), 1);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${directory}/login-recovered.png`, fullPage: true });
    await writeFile(
      `${directory}/results.json`,
      JSON.stringify(
        {
          status: 'PASS',
          date: new Date().toISOString(),
          unavailableStatus: 503,
          retryStatus: 200,
          fieldsRetained: true,
          passwordNotPersisted: true,
          sessionCount: 1,
          loginAuditCount: 1,
          homePath: '/pos',
          browserErrors: errors,
          notes: [
            'Isolated _test fixture; existing accounts/data and the live application were preserved.',
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS Same browser form retries after recovery, signs in once and opens the cashier role page.',
    );
  } finally {
    await browser?.close();
    await stop(server);
    await db.$disconnect();
    await writeFile(`${directory}/server.log`, serverOutput);
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Login recovery acceptance failed.');
  process.exitCode = 1;
});
