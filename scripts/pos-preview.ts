import '../tests/setup';
import { chromium } from 'playwright';
import { db } from '../src/lib/db';
import { DEFAULT_SEED_PASSWORD } from './seed-data';
import { mkdir } from 'node:fs/promises';

async function main() {
  const origin = 'http://localhost:3000';
  const user = await db.user.findUniqueOrThrow({ where: { username: 'demo.cashier01' } });
  const customer = await db.registration.findFirstOrThrow({
    where: { eventId: user.assignedEventId!, account: { status: 'ACTIVE', orders: { none: {} } } },
    include: { account: { include: { credentials: { where: { revokedAt: null } } } } },
  });
  const browser = await chromium.launch({
    executablePath:
      process.env.BROWSER_EXECUTABLE ??
      (process.platform === 'win32'
        ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
        : undefined),
    headless: true,
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const login = await context.request.post(origin + '/api/auth', {
      headers: { Origin: origin },
      data: {
        username: user.username,
        password: process.env.SEED_PASSWORD ?? DEFAULT_SEED_PASSWORD,
      },
    });
    if (!login.ok()) throw new Error('Demo preview login failed.');
    const page = await context.newPage();
    await page.goto(origin + '/pos');
    await page.getByPlaceholder('ค้นหาสินค้า / รหัสสินค้า').fill('DEMO-');
    await page
      .locator('.product-add')
      .filter({ has: page.getByText('DEMO-TEA', { exact: true }) })
      .click();
    await page
      .locator('.product-add')
      .filter({ has: page.getByText('DEMO-COFFEE', { exact: true }) })
      .click();
    await mkdir('.local/previews', { recursive: true });
    await page.screenshot({ path: '.local/previews/pos-desktop-preview.png' });
    await page.getByRole('button', { name: 'ตรวจสอบ QR และบันทึก' }).click();
    await page
      .getByRole('textbox', { name: 'Customer QR', exact: true })
      .fill(customer.account!.credentials[0].token);
    await page.getByRole('textbox', { name: 'Customer QR', exact: true }).press('Enter');
    await page.getByRole('button', { name: 'ยืนยันบันทึกรายการ', exact: true }).waitFor();
    await page.screenshot({ path: '.local/previews/pos-qr-preview.png' });
    console.log('Saved real demo POS and QR modal previews; no sale submitted.');
  } finally {
    await browser.close();
  }
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Preview failed');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
