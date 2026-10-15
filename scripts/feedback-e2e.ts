import '../tests/setup';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { db } from '../src/lib/db';
import { fixture } from '../tests/helpers';
import { manage } from '../src/lib/management';
import { testPort } from './test-port';

async function main() {
  const directory = 'docs/validation/feedback';
  await mkdir(directory, { recursive: true });
  const f = await fixture();
  await db.event.update({
    where: { id: f.fixtureEvent.id },
    data: { name: 'CCIDA กิจกรรมทดสอบแบบประเมิน' },
  });
  const previousOrganization = await db.systemSetting.findUnique({
    where: { key: 'organization' },
  });
  const previousLayout = await db.systemSetting.findUnique({ where: { key: 'receipt-layout' } });
  const port = await testPort();
  const base = `http://127.0.0.1:${port}`;
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
        APP_ORIGIN: base,
        COOKIE_SECURE: 'false',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let serverLog = '';
  server.stdout.on('data', (chunk) => {
    serverLog += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    serverLog += chunk.toString();
  });
  const browser = await chromium.launch({
    executablePath:
      process.env.BROWSER_EXECUTABLE ??
      (process.platform === 'win32'
        ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
        : undefined),
    headless: true,
  });
  const checks: string[] = [];
  const pass = (check: string) => {
    checks.push(check);
    console.log(`PASS ${check}`);
  };
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        if ((await fetch(base + '/api/health')).ok) {
          healthy = true;
          break;
        }
      } catch {
        /* Wait only for this owned test process. */
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(healthy, 'Feedback acceptance server must become healthy');
    const logo = `data:image/png;base64,${(await readFile('public/receipt-logo.png')).toString('base64')}`;
    await manage(f.actors.SUPER_ADMIN, 'settings.save', {
      organization: 'ทัณฑสถานบำบัดพิเศษกลาง',
      receiptLogo: logo,
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
    const page = await context.newPage();
    const errors: string[] = [];
    const external: string[] = [];
    let dialogs = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => {
      dialogs++;
      void dialog.dismiss();
    });
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== base) external.push(request.url());
    });
    await page.goto(`${base}/feedback?event=${f.fixtureEvent.id}`);
    await page.getByRole('heading', { name: 'วันนี้เป็นอย่างไรบ้าง?' }).waitFor();
    assert.equal(await page.locator('.sidebar').count(), 0);
    assert.equal(await page.locator('input[type=password]').count(), 0);
    assert.equal(await page.locator('select[name=eventId]').inputValue(), f.fixtureEvent.id);
    assert.equal(await page.locator('.feedback-brand img').count(), 1);
    pass(
      'Public feedback needs no login, displays the organization logo and preselects the receipt event',
    );
    await page.getByRole('radio', { name: '5 ดาว · ดีมาก', exact: true }).check();
    await page.locator('select[name=serviceRating]').selectOption('4');
    await page.locator('select[name=speedRating]').selectOption('3');
    await page.getByRole('radio', { name: 'คำชม', exact: true }).check();
    const message = 'บริการดีมาก ขอบคุณเจ้าหน้าที่ทุกท่าน <img src=x onerror=alert(1)>';
    await page.locator('textarea[name=message]').fill('บริการดีมาก ขอบคุณเจ้าหน้าที่ทุกท่าน');
    await page.screenshot({ path: `${directory}/desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    );
    await page.screenshot({ path: `${directory}/mobile.png`, fullPage: true });
    pass('Desktop/mobile ratings, optional details and comments fit without horizontal scrolling');
    await page.locator('textarea[name=message]').fill(message);
    let dropped = false;
    await page.route('**/api/feedback', async (route) => {
      if (route.request().method() === 'POST' && !dropped) {
        dropped = true;
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        await route.abort('failed');
      } else await route.continue();
    });
    await page.getByRole('button', { name: 'ส่งความคิดเห็น', exact: true }).click();
    await page
      .getByRole('button', { name: 'ลองส่งความคิดเห็นเดิมอีกครั้ง', exact: true })
      .waitFor();
    const saved = await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem('ccida:feedback-intent') ?? 'null') as { key: string },
    );
    assert.ok(saved?.key);
    assert.equal(await db.feedback.count({ where: { submissionKey: saved.key } }), 1);
    await page.reload();
    await page
      .getByRole('button', { name: 'ลองส่งความคิดเห็นเดิมอีกครั้ง', exact: true })
      .waitFor();
    assert.equal(await page.locator('textarea[name=message]').inputValue(), message);
    await page.getByRole('button', { name: 'ลองส่งความคิดเห็นเดิมอีกครั้ง', exact: true }).click();
    await page.getByRole('heading', { name: 'ขอบคุณสำหรับความคิดเห็น', exact: true }).waitFor();
    assert.equal(await db.feedback.count({ where: { submissionKey: saved.key } }), 1);
    const stored = await db.feedback.findUniqueOrThrow({ where: { submissionKey: saved.key } });
    assert.equal(stored.customerName, null);
    assert.equal(stored.contact, null);
    assert.equal(stored.eventId, f.fixtureEvent.id);
    assert.equal(stored.serviceRating, 4);
    await page.screenshot({ path: `${directory}/thank-you.png`, fullPage: true });
    pass(
      'Anonymous submission, lost response, reload and original-key retry save one response with a thank-you confirmation',
    );
    assert.equal((await context.request.get(`${base}/api/feedback`)).status(), 401);
    pass('Unauthenticated visitors cannot read feedback responses');
    for (const role of ['ADMIN', 'SUPER_ADMIN'] as const) {
      const account = await db.user.findUniqueOrThrow({ where: { id: f.actors[role].id } });
      const login = await context.request.post(`${base}/api/auth`, {
        headers: { Origin: base },
        data: { username: account.username, password: 'test-password-12345' },
      });
      assert.equal(login.status(), 200);
      if (role === 'ADMIN') {
        assert.equal((await context.request.get(`${base}/api/feedback`)).status(), 403);
        await page.goto(`${base}/feedback-responses`);
        await page.waitForURL(`${base}/dashboard`);
        pass('Admin is denied detailed feedback through both API and page routes');
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${base}/dashboard`);
    await page.getByRole('button', { name: 'ความคิดเห็น', exact: true }).click();
    await page.waitForURL(`${base}/feedback-responses`);
    await page.getByRole('heading', { name: 'ความคิดเห็นจากผู้ใช้บริการ', exact: true }).waitFor();
    await page
      .getByLabel('กรองความคิดเห็นตามกิจกรรม', { exact: true })
      .selectOption(f.fixtureEvent.id);
    await page.getByText(message, { exact: true }).waitFor();
    assert.equal(await page.locator('.feedback-response').count(), 1);
    assert.equal(await page.locator('.feedback-response img').count(), 0);
    assert.equal(
      await page.getByLabel('ลิงก์แบบประเมิน').inputValue(),
      `${base}/feedback?event=${f.fixtureEvent.id}`,
    );
    await page.screenshot({ path: `${directory}/superadmin-review.png`, fullPage: true });
    assert.equal(dialogs, 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    pass(
      'Super Admin reviews event-scoped feedback, rating summaries and the receipt QR link with escaped comments',
    );
    pass('No browser errors, script execution or external asset requests');
    await context.request.delete(`${base}/api/auth`, { headers: { Origin: base } });
    await context.close();
    await writeFile(
      `${directory}/results.json`,
      JSON.stringify(
        {
          status: 'PASS',
          date: new Date().toISOString(),
          checks: checks.map((check) => ({ check, status: 'PASS' })),
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await browser.close();
    server.kill();
    for (const [key, previous] of [
      ['organization', previousOrganization],
      ['receipt-layout', previousLayout],
    ] as const) {
      if (previous)
        await db.systemSetting.upsert({
          where: { key },
          create: { key, value: previous.value! },
          update: { value: previous.value! },
        });
      else await db.systemSetting.deleteMany({ where: { key } });
    }
    await writeFile(`${directory}/server.log`, serverLog);
  }
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Feedback acceptance failed');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
