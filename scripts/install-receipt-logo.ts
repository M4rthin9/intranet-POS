// Install through the real local app's authorized settings UI, preserving other settings.
import '../tests/setup';
import { chromium } from 'playwright';
import { db } from '../src/lib/db';
import { DEFAULT_SEED_PASSWORD } from './seed-data';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

async function main() {
  const source = process.argv[2];
  if (!source) throw new Error('Supply the receipt logo image path.');
  const original = await readFile(source);
  const sourceHash = createHash('sha256').update(original).digest('hex');
  const origin = 'http://localhost:3000';
  const browser = await chromium.launch({
    executablePath:
      process.env.BROWSER_EXECUTABLE ??
      (process.platform === 'win32'
        ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
        : undefined),
    headless: true,
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const login = await context.request.post(origin + '/api/auth', {
      headers: { Origin: origin },
      data: {
        username: 'demo.superadmin',
        password: process.env.SEED_PASSWORD ?? DEFAULT_SEED_PASSWORD,
      },
    });
    assert.ok(login.ok(), 'Local Super Admin login failed.');
    assert.equal((await login.json()).user.roleName, 'SUPER_ADMIN');
    const before = await (await context.request.get(origin + '/api/data?view=settings')).json();
    const page = await context.newPage();
    await page.goto(origin + '/settings');
    await page.getByLabel('อัปโหลดโลโก้ใบเสร็จ', { exact: true }).setInputFiles(source);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/operations') &&
        response.request().postDataJSON()?.action === 'settings.save',
    );
    await page.getByRole('button', { name: 'บันทึกโลโก้', exact: true }).click();
    assert.equal((await saved).status(), 200);
    await page.reload();
    await page.getByAltText('ตัวอย่างโลโก้ใบเสร็จ', { exact: true }).waitFor();
    const after = await (await context.request.get(origin + '/api/data?view=settings')).json();
    for (const key of [
      'organization',
      'receiptHeader',
      'receiptFooter',
      'receiptQrValue',
      'receiptQrLabel',
    ])
      assert.equal(after[key], before[key]);
    assert.ok(after.receiptLogo.startsWith('data:image/png;base64,'));
    assert.equal(
      createHash('sha256')
        .update(await readFile(source))
        .digest('hex'),
      sourceHash,
    );
    await mkdir('docs/validation/final', { recursive: true });
    await writeFile(
      'docs/validation/final/receipt-logo-image.png',
      Buffer.from(after.receiptLogo.slice('data:image/png;base64,'.length), 'base64'),
    );
    await page.screenshot({
      path: 'docs/validation/final/receipt-logo-settings.png',
      fullPage: true,
    });
    const receipt = await db.payment.findFirst({
      where: {
        status: 'CONFIRMED',
        account: { registration: { customerName: 'UI acceptance customer' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (receipt) {
      await page.goto(origin + '/payments');
      const scanner = page.getByRole('textbox', { name: 'Customer QR', exact: true });
      await scanner.fill(receipt.number);
      await scanner.press('Enter');
      await page.getByRole('heading', { name: 'สำเนา / COPY', exact: true }).waitFor();
      await page
        .locator('.receipt .receipt-logo')
        .evaluate((image) => (image as HTMLImageElement).decode());
      await page
        .locator('.receipt')
        .screenshot({ path: 'docs/validation/final/receipt-with-organization-logo.png' });
      await page.emulateMedia({ media: 'print' });
      const printed = await page.locator('.receipt').evaluate((paper) => {
        const p = paper.getBoundingClientRect();
        const logo = paper.querySelector('.receipt-logo')!.getBoundingClientRect();
        return {
          receiptWidth: p.width,
          logoWidth: logo.width,
          logoHeight: logo.height,
          center: Math.abs((logo.left + logo.right - p.left - p.right) / 2),
          overflow: paper.scrollWidth > paper.clientWidth + 1,
        };
      });
      assert.ok(printed.center < 1 && !printed.overflow);
      const pdf = await page.pdf({
        path: 'docs/validation/final/receipt-with-organization-logo-80mm.pdf',
        preferCSSPageSize: true,
        printBackground: true,
      });
      assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length, 1);
      await writeFile(
        'docs/validation/final/receipt-organization-logo-layout.json',
        JSON.stringify({ sourceUnchanged: true, settingsPreserved: true, ...printed }, null, 2),
      );
    }
    console.log('Organization logo installed; original file and other receipt settings preserved.');
  } finally {
    await browser.close();
  }
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Receipt logo installation failed.');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
