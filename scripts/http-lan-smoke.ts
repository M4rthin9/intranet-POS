import '../tests/setup';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { salesFixture } from '../tests/sales-helpers';
import { db } from '../src/lib/db';
import { login } from '../src/lib/auth';
import { testPort } from './test-port';
let origin = '';
async function main() {
  const port = await testPort();
  origin = `http://pos.ccida.test:${port}`;
  const server = spawn(
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
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        APP_ORIGIN: origin,
        COOKIE_SECURE: 'false',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      windowsHide: true,
      stdio: 'ignore',
    },
  );
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    for (let i = 0; i < 120; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break;
      } catch {
        /* Wait for the owned local server. */
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const f = await salesFixture();
    const user = await db.user.findUniqueOrThrow({ where: { id: f.actors.CASHIER.id } });
    const session = await login(user.username, 'test-password-12345', 'lan-acceptance');
    browser = await chromium.launch({
      executablePath:
        process.env.BROWSER_EXECUTABLE ??
        (process.platform === 'win32'
          ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
          : undefined),
      headless: true,
      args: ['--host-resolver-rules=MAP pos.ccida.test 127.0.0.1', '--no-proxy-server'],
    });
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: 'ccida_session',
        value: session.token,
        domain: 'pos.ccida.test',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Strict',
      },
    ]);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin);
    await page.locator('.workspace').waitFor();
    assert.equal(await page.evaluate(() => window.isSecureContext), false);
    assert.equal(await page.evaluate(() => typeof crypto.randomUUID), 'undefined');
    // The existing shift determines the correct operating context automatically.
    await page.locator('.staff-event').waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'กิจกรรม', exact: true }).count(), 0);
    assert.equal(await page.locator('.shift-bar').count(), 0);
    assert.equal(await page.getByRole('combobox', { name: 'จุดบริการ', exact: true }).count(), 0);
    await page.getByPlaceholder('ค้นหาสินค้า / รหัสสินค้า').fill(f.tag);
    await page.locator('.product-add').click();
    await page.getByRole('button', { name: 'ตรวจสอบ QR และบันทึก' }).click();
    await page.getByRole('textbox', { name: 'Customer QR' }).fill(f.registration.token);
    await page.getByRole('textbox', { name: 'Customer QR' }).press('Enter');
    await page.getByRole('button', { name: 'ยืนยันบันทึกรายการ', exact: true }).click();
    await page.getByText('รับชำระที่จุดชำระเงิน', { exact: false }).waitFor();
    const order = await db.order.findFirstOrThrow({
      where: { accountId: f.registration.account.id },
    });
    assert.equal(order.totalSatang, 4550);
    assert.deepEqual(errors, []);
    await writeFile(
      'docs/validation/final/http-lan.json',
      JSON.stringify(
        {
          status: 'PASS',
          origin,
          secureContext: false,
          nativeRandomUUID: false,
          cryptographicCheckoutKey: true,
          recordedOrderSatang: 4550,
          date: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS Ordinary HTTP LAN origin: secure UUID key, scanner checkout, server order and no browser errors',
    );
  } finally {
    if (browser) await browser.close();
    server.kill();
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'LAN acceptance failed');
  process.exitCode = 1;
});
