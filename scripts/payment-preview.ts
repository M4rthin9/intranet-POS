import '../tests/setup';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DEFAULT_SEED_PASSWORD } from './seed-data';
import { mkdir, writeFile } from 'node:fs/promises';

async function main() {
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
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const login = await context.request.post(origin + '/api/auth', {
      headers: { Origin: origin },
      data: {
        username: 'demo.payment',
        password: process.env.SEED_PASSWORD ?? DEFAULT_SEED_PASSWORD,
      },
    });
    assert.ok(login.ok(), 'Demo payment login failed.');
    const page = await context.newPage();
    const dashboardRequests: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/dashboard') dashboardRequests.push('dashboard');
    });
    await page.goto(origin + '/');
    await page.waitForURL(origin + '/payments');
    await page.getByRole('heading', { name: 'พร้อมรับชำระเงิน', exact: true }).waitFor();
    assert.equal(await page.locator('.sidebar, nav, .kpis, .shift-bar').count(), 0);
    assert.equal(await page.getByRole('combobox', { name: 'กิจกรรม', exact: true }).count(), 0);
    await page.waitForFunction(
      () => document.activeElement === document.querySelector('#payment-customer-qr'),
    );
    await mkdir('docs/validation/final', { recursive: true });
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: width === 1366 ? 768 : 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({
        path: `docs/validation/final/payment-start-${width}.png`,
        fullPage: true,
      });
    }
    await page.goto(origin + '/dashboard');
    await page.waitForURL(origin + '/payments');
    await page.getByRole('heading', { name: 'พร้อมรับชำระเงิน', exact: true }).waitFor();
    assert.equal(dashboardRequests.length, 0);
    await writeFile(
      'docs/validation/final/payment-live-preview.json',
      JSON.stringify(
        {
          loginRedirect: 'payments',
          menu: false,
          shiftControls: false,
          dashboardRedirect: 'payments',
          dashboardRequests: 0,
          scannerFocus: true,
          desktopMobileOverflow: false,
          financialOperationsSubmitted: 0,
        },
        null,
        2,
      ),
    );
    console.log('Payment-only live preview PASS; no financial operations submitted.');
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Payment preview failed.');
  process.exitCode = 1;
});
