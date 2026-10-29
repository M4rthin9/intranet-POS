import '../tests/setup';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { salesFixture } from '../tests/sales-helpers';
import { db } from '../src/lib/db';
import { registrationAction } from '../src/lib/registration';
import { paymentAction } from '../src/lib/payments';
import { testPort } from './test-port';

async function main() {
  const f = await salesFixture();
  await registrationAction(f.actors.SUPER_ADMIN, 'event.save', {
    id: f.event.id,
    code: `SALE-${f.tag}`,
    name: 'Instant POS browser check',
    status: 'OPEN',
    paymentMode: 'INSTANT',
  });
  await paymentAction(f.actors.SUPER_ADMIN, 'promptpay.save', {
    type: 'PHONE',
    identifier: '0812345678',
    displayName: 'Browser test recipient',
    enabled: true,
  });
  const hiddenCategory = await db.category.create({ data: { name: `Hidden browser ${f.tag}` } });
  await db.product.create({
    data: {
      code: `HIDDEN-${f.tag}`,
      name: 'Hidden browser product',
      categoryId: hiddenCategory.id,
      priceSatang: 100,
    },
  });
  const port = await testPort();
  const origin = `http://127.0.0.1:${port}`;
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
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  server.stdout.on('data', (data) => {
    output += data.toString();
  });
  server.stderr.on('data', (data) => {
    output += data.toString();
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    let started = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        if ((await fetch(origin + '/api/health')).ok) {
          started = true;
          break;
        }
      } catch {
        /* Starting owned server. */
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(started, output);
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.BROWSER_EXECUTABLE ??
        (process.platform === 'win32'
          ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
          : undefined),
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
      window.print = () => {};
    });
    const errors: string[] = [];
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    const user = await db.user.findUniqueOrThrow({ where: { id: f.actors.CASHIER.id } });
    const login = await context.request.post(origin + '/api/auth', {
      headers: { Origin: origin },
      data: { username: user.username, password: 'test-password-12345' },
    });
    assert.ok(login.ok(), await login.text());
    await page.goto(origin + '/pos');
    await page.locator('.product-add').first().waitFor();
    assert.equal(await page.locator('.product-add').count(), 1);
    assert.equal(
      await page.getByRole('button', { name: hiddenCategory.name, exact: true }).count(),
      0,
    );
    await page.locator('.product-add').first().click();
    await page.getByRole('button', { name: 'รับชำระเงิน', exact: true }).click();
    assert.equal(
      await page.getByRole('textbox', { name: 'Customer QR', exact: true }).isVisible(),
      false,
    );
    let dropped = false;
    await page.route('**/api/operations', async (route) => {
      if (!dropped && route.request().postDataJSON()?.action === 'order.create') {
        dropped = true;
        const response = await route.fetch();
        assert.ok(response.ok());
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Simulated lost sale response' }),
        });
      } else await route.continue();
    });
    await page.getByRole('button', { name: 'เตรียมรับชำระ', exact: true }).click();
    await page.getByRole('button', { name: 'ลองส่งรายการเดิมอีกครั้ง', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'ลองส่งรายการเดิมอีกครั้ง', exact: true }).click();
    await page.getByRole('textbox', { name: 'รับเงินสด (บาท)', exact: true }).fill('50');
    await page.getByRole('checkbox', { name: 'ตรวจนับและรับเงินสดแล้ว' }).check();
    await page.getByRole('button', { name: 'ยืนยันรับชำระและพิมพ์ใบเสร็จ' }).click();
    await page.locator('.receipt-print-overlay').waitFor();
    assert.equal(await page.locator('dialog[open]').count(), 0);
    await mkdir('.local/previews', { recursive: true });
    await page.screenshot({ path: '.local/previews/instant-pos-cash-receipt.png' });
    await page.locator('.print-actions').getByRole('button', { name: 'ปิด', exact: true }).click();
    await page.locator('.product-add').first().click();
    await page.getByRole('button', { name: 'รับชำระเงิน', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'วิธีชำระเงิน', exact: true })
      .selectOption('PROMPTPAY');
    await page.getByRole('button', { name: 'เตรียมรับชำระ', exact: true }).click();
    await page.getByRole('img', { name: 'PromptPay QR', exact: true }).waitFor();
    await page.screenshot({ path: '.local/previews/instant-pos-promptpay.png' });
    await page.reload();
    await page.locator('.pos-history summary').first().click();
    await page.getByRole('button', { name: 'รับชำระต่อ', exact: true }).click();
    await page.getByRole('img', { name: 'PromptPay QR', exact: true }).waitFor();
    await page
      .getByRole('textbox', { name: 'เลขอ้างอิงธนาคาร', exact: true })
      .fill(`BANK-${f.tag}`);
    await page.getByRole('checkbox', { name: 'ตรวจสอบเงินเข้าบัญชีธนาคารแล้ว' }).check();
    await page.getByRole('button', { name: 'ยืนยันรับชำระและพิมพ์ใบเสร็จ' }).click();
    await page.locator('.receipt-print-overlay').waitFor();
    assert.equal(await db.order.count({ where: { eventId: f.event.id, status: 'PAID' } }), 2);
    await page.locator('.print-actions').getByRole('button', { name: 'ปิด', exact: true }).click();
    const adminContext = await browser.newContext();
    const admin = await db.user.findUniqueOrThrow({ where: { id: f.actors.SUPER_ADMIN.id } });
    assert.ok(
      (
        await adminContext.request.post(origin + '/api/auth', {
          headers: { Origin: origin },
          data: { username: admin.username, password: 'test-password-12345' },
        })
      ).ok(),
    );
    const adminPage = await adminContext.newPage();
    await adminPage.goto(origin + '/users');
    await adminPage
      .getByRole('textbox', { name: 'ค้นหาผู้ใช้งาน', exact: true })
      .fill(user.username);
    const row = adminPage.getByRole('row').filter({ hasText: user.username });
    await row.getByRole('button', { name: 'แก้ไข', exact: true }).click();
    assert.ok(
      await adminPage.getByRole('checkbox', { name: `Drinks-${f.tag}`, exact: true }).isChecked(),
    );
    await adminPage.getByRole('checkbox', { name: `Drinks-${f.tag}`, exact: true }).uncheck();
    await adminPage.getByRole('checkbox', { name: hiddenCategory.name, exact: true }).check();
    const saved = adminPage.waitForResponse(
      (response) =>
        response.url().endsWith('/api/operations') &&
        response.request().postDataJSON()?.action === 'user.save',
    );
    await adminPage.getByRole('button', { name: 'บันทึก', exact: true }).click();
    assert.ok((await saved).ok());
    await page.reload();
    await page.getByRole('button', { name: hiddenCategory.name, exact: true }).waitFor();
    assert.equal(await page.locator('.product-add').count(), 1);
    assert.equal(
      await page.getByRole('button', { name: `Drinks-${f.tag}`, exact: true }).count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS: restricted categories, admin category assignment, QR-free walk-in checkout, lost order response/reload/retry, cash/change receipt, PromptPay QR, reload/resume, confirmed receipts, no browser errors.',
    );
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    await browser?.close();
    server.kill();
  }
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
