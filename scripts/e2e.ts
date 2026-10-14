import '../tests/setup';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium, type Page, type BrowserContext } from 'playwright';
import { fixture } from '../tests/helpers';
import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';
import type { RoleName } from '@prisma/client';
import type {
  AccountDto,
  PaymentDto,
  PrintDto,
  ReceiptDto,
  OrderDto,
} from '../src/components/types';
import type { Summary } from '../src/lib/reports';

const base = 'http://127.0.0.1:3100';
const results: { check: string; status: 'PASS' }[] = [];
const pass = (check: string) => {
  results.push({ check, status: 'PASS' });
  console.log(`PASS ${check}`);
};
const cookies = {} as Record<RoleName | 'SECOND_CASHIER', string>;
async function request(url: string, role?: keyof typeof cookies, body?: unknown, expected = 200) {
  const response = await fetch(base + url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      ...(role ? { Cookie: cookies[role] } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(
    response.status,
    expected,
    `${url}: expected ${expected}, received ${response.status}`,
  );
  return response;
}
async function operation<T>(
  role: keyof typeof cookies,
  action: string,
  input: unknown,
  expected = 200,
): Promise<T> {
  return (await request('/api/operations', role, { action, input }, expected)).json() as Promise<T>;
}
async function signIn(role: keyof typeof cookies, username: string) {
  const response = await request('/api/auth', undefined, {
    username,
    password: 'test-password-12345',
  });
  cookies[role] = response.headers.get('set-cookie')!.split(';')[0];
  assert.match(response.headers.get('set-cookie')!, /HttpOnly/i);
  assert.match(response.headers.get('set-cookie')!, /SameSite=strict/i);
}
async function selectContext(page: Page, eventId: string, stationId: string) {
  await page.locator('.workspace').waitFor();
  await page.getByRole('combobox', { name: 'กิจกรรม', exact: true }).selectOption(eventId);
  await page.getByRole('combobox', { name: 'จุดบริการ', exact: true }).selectOption(stationId);
}
async function main() {
  const server = spawn(
    process.execPath,
    [
      path.resolve('node_modules/next/dist/bin/next'),
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3100',
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        APP_ORIGIN: base,
        COOKIE_SECURE: 'false',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let serverOutput = '';
  server.stdout.on('data', (b) => {
    serverOutput += b.toString();
  });
  server.stderr.on('data', (b) => {
    serverOutput += b.toString();
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  await mkdir('docs/validation/final', { recursive: true });
  try {
    let started = false;
    for (let i = 0; i < 120; i++) {
      try {
        if ((await fetch(base + '/api/health')).ok) {
          started = true;
          break;
        }
      } catch {
        /* Wait for owned production server. */
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(started, 'Production server did not become healthy.');
    pass('Production server and PostgreSQL health');
    const f = await fixture();
    const second = await db.user.create({
      data: {
        username: `${f.tag}-ui-second`,
        displayName: 'Second cashier',
        roleName: 'CASHIER',
        passwordHash: hashPassword('test-password-12345'),
      },
    });
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'CASHIER', 'PAYMENT_CASHIER'] as const) {
      const u = await db.user.findUniqueOrThrow({ where: { id: f.actors[role].id } });
      await signIn(role, u.username);
    }
    await signIn('SECOND_CASHIER', second.username);
    pass('All four roles authenticate with protected cookies');
    await request('/api/data?view=users', 'CASHIER', undefined, 403);
    await request('/api/data?view=audit', undefined, undefined, 401);
    await operation('CASHIER', 'payment.confirm', {}, 403);
    await operation('ADMIN', 'order.create', {}, 403);
    await operation('PAYMENT_CASHIER', 'registration.create', {}, 403);
    pass('Unauthorized and unauthenticated API access rejected');
    const badOrigin = await fetch(base + '/api/operations', {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
        Cookie: cookies.SUPER_ADMIN,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    assert.equal(badOrigin.status, 403);
    pass('CSRF origin rejection');
    const event = await operation<{ id: string }>('SUPER_ADMIN', 'event.save', {
      code: `E2E-${f.tag}`,
      name: 'E2E validation event',
      status: 'OPEN',
    });
    pass('SUPER_ADMIN creates and opens event');
    const registration = await operation<PrintDto & { id: string; account: { id: string } }>(
      'ADMIN',
      'registration.create',
      { eventId: event.id, stationId: f.stations[0].id, customerName: 'E2E customer' },
    );
    assert.match(registration.token!, /^CCA-[A-Za-z0-9_-]{43}$/);
    assert.match(registration.qrImage, /^data:image\/png;base64,/);
    pass('ADMIN registers customer and generates opaque QR');
    const category = await operation<{ id: string }>('SUPER_ADMIN', 'category.save', {
      name: `E2E drinks ${f.tag}`,
    });
    const tea = await operation<{ id: string }>('SUPER_ADMIN', 'product.save', {
      code: `TEA-${f.tag}`,
      name: `ชาไทย ${f.tag}`,
      categoryId: category.id,
      priceBaht: '40.00',
    });
    const coffee = await operation<{ id: string }>('SUPER_ADMIN', 'product.save', {
      code: `COFFEE-${f.tag}`,
      name: `กาแฟ ${f.tag}`,
      categoryId: category.id,
      priceBaht: '60.00',
    });
    for (const [role, stationIndex] of [
      ['CASHIER', 1],
      ['SECOND_CASHIER', 2],
      ['PAYMENT_CASHIER', 3],
    ] as const)
      await operation(role, 'shift.open', {
        eventId: event.id,
        stationId: f.stations[stationIndex].id,
      });
    const orderIntent = {
      eventId: event.id,
      stationId: f.stations[1].id,
      token: registration.token,
      key: randomUUID(),
      items: [{ productId: tea.id, quantity: 2 }],
    };
    const order = await operation<OrderDto>('CASHIER', 'order.create', {
      ...orderIntent,
      totalSatang: 1,
    });
    assert.equal(order.totalSatang, 8000);
    const duplicate = await operation<OrderDto>('CASHIER', 'order.create', orderIntent);
    assert.equal(duplicate.id, order.id);
    pass('First POS order uses server price and duplicate checkout returns original');
    await operation('SECOND_CASHIER', 'order.create', {
      ...orderIntent,
      stationId: f.stations[2].id,
      key: randomUUID(),
      items: [{ productId: coffee.id, quantity: 1 }],
    });
    let account = await operation<AccountDto>('PAYMENT_CASHIER', 'account.lookup', {
      eventId: event.id,
      token: registration.token,
    });
    assert.equal(account.outstandingSatang, 14000);
    assert.equal(account.orders.length, 2);
    pass('Second POS purchase and exact combined outstanding');
    await operation(
      'PAYMENT_CASHIER',
      'account.lookup',
      { eventId: event.id, token: 'CCA-invalid-token' },
      404,
    );
    await operation('ADMIN', 'qr.block', {
      registrationId: registration.id,
      reason: 'Security test',
    });
    await operation(
      'CASHIER',
      'account.lookup',
      { eventId: event.id, token: registration.token },
      409,
    );
    const replaced = await operation<PrintDto>('ADMIN', 'qr.reissue', {
      registrationId: registration.id,
      reason: 'Replacement card',
    });
    await operation(
      'CASHIER',
      'account.lookup',
      { eventId: event.id, token: registration.token },
      404,
    );
    await operation('ADMIN', 'registration.update', {
      id: registration.id,
      customerName: 'E2E customer',
      status: 'ACTIVE',
      reason: 'Security review completed',
    });
    account = await operation<AccountDto>('PAYMENT_CASHIER', 'account.lookup', {
      eventId: event.id,
      token: replaced.token,
    });
    assert.equal(account.orders.length, 2);
    assert.equal(account.outstandingSatang, 14000);
    pass('Invalid, blocked and replaced QR; replacement preserves both orders');
    await operation('SUPER_ADMIN', 'promptpay.save', {
      type: 'PHONE',
      identifier: '0812345678',
      displayName: 'TEST RECIPIENT ONLY',
      enabled: true,
    });
    const pay = await operation<PaymentDto & { qrPayload: string }>(
      'PAYMENT_CASHIER',
      'payment.generate',
      {
        eventId: event.id,
        stationId: f.stations[3].id,
        token: replaced.token,
        key: randomUUID(),
        amountSatang: 1,
      },
    );
    assert.equal(pay.amountSatang, 14000);
    assert.equal(pay.status, 'AWAITING_CONFIRMATION');
    assert.match(pay.qrPayload, /5406140\.00/);
    pass('Dynamic PromptPay amount is exact and not automatically confirmed');
    const confirmation = {
      paymentId: pay.id,
      stationId: f.stations[3].id,
      key: randomUUID(),
      reference: randomUUID(),
      evidence: 'Verified exact recipient, amount and bank evidence',
      evidenceVerified: true,
    };
    await operation('PAYMENT_CASHIER', 'payment.confirm', confirmation);
    await operation('PAYMENT_CASHIER', 'payment.confirm', confirmation);
    const allocations = await db.paymentAllocation.findMany({ where: { paymentId: pay.id } });
    assert.equal(allocations.length, 2);
    assert.equal(
      allocations.reduce((n, a) => n + a.amountSatang, 0),
      14000,
    );
    assert.equal(
      (await db.customerAccount.findUniqueOrThrow({ where: { id: registration.account.id } }))
        .status,
      'SETTLED',
    );
    pass('Payment confirmed once, exact allocations and SETTLED');
    const firstReceipt = await operation<ReceiptDto>('PAYMENT_CASHIER', 'receipt.print', {
      paymentId: pay.id,
    });
    const copyReceipt = await operation<ReceiptDto>('PAYMENT_CASHIER', 'receipt.print', {
      paymentId: pay.id,
    });
    assert.equal(firstReceipt.copy, false);
    assert.equal(copyReceipt.copy, true);
    await operation(
      'PAYMENT_CASHIER',
      'payment.generate',
      { eventId: event.id, stationId: f.stations[3].id, token: replaced.token, key: randomUUID() },
      409,
    );
    pass('Receipt, audited COPY and duplicate settlement prevention');
    const correction = await operation<PrintDto & { id: string }>('ADMIN', 'registration.create', {
      eventId: event.id,
      stationId: f.stations[0].id,
      customerName: 'Void order test',
    });
    const voidable = await operation<OrderDto>('CASHIER', 'order.create', {
      ...orderIntent,
      token: correction.token,
      key: randomUUID(),
      items: [{ productId: tea.id, quantity: 1 }],
    });
    await operation(
      'CASHIER',
      'order.void',
      { id: voidable.id, key: randomUUID(), reason: 'Wrong item' },
      403,
    );
    await operation('SUPER_ADMIN', 'order.void', {
      id: voidable.id,
      key: randomUUID(),
      reason: 'Wrong item',
    });
    await operation('SUPER_ADMIN', 'payment.void', {
      id: pay.id,
      key: randomUUID(),
      reason: 'Verification correction',
    });
    assert.equal(
      (
        await operation<AccountDto>('PAYMENT_CASHIER', 'account.lookup', {
          eventId: event.id,
          token: replaced.token,
        })
      ).outstandingSatang,
      14000,
    );
    const repayment = await operation<PaymentDto>('PAYMENT_CASHIER', 'payment.generate', {
      eventId: event.id,
      stationId: f.stations[3].id,
      token: replaced.token,
      key: randomUUID(),
    });
    await operation('PAYMENT_CASHIER', 'payment.confirm', {
      ...confirmation,
      paymentId: repayment.id,
      key: randomUUID(),
      reference: randomUUID(),
    });
    pass('Controlled order/payment void and balance restoration without deletion');
    const summary = (await (
      await request(`/api/reports?eventId=${event.id}`, 'SUPER_ADMIN')
    ).json()) as Summary;
    assert.equal(summary.netSalesSatang, 14000);
    assert.equal(summary.confirmedPaymentSatang, 14000);
    assert.equal(summary.outstandingSatang, 0);
    assert.ok(summary.reconciled);
    const auditRows = (await (
      await request(`/api/data?view=audit&eventId=${event.id}`, 'SUPER_ADMIN')
    ).json()) as { action: string }[];
    for (const action of [
      'EVENT_CREATE',
      'REGISTRATION_CREATE',
      'QR_REISSUE',
      'ORDER_CREATE',
      'PAYMENT_QR_GENERATE',
      'PAYMENT_CONFIRM',
      'RECEIPT_REPRINT',
      'ORDER_VOID',
      'PAYMENT_VOID',
    ])
      assert.ok(
        auditRows.some((r) => r.action === action),
        action,
      );
    const csv = await (
      await request(`/api/export?eventId=${event.id}&type=payments`, 'SUPER_ADMIN')
    ).text();
    assert.ok(csv.includes(pay.number));
    pass('Dashboard, reports, complete audit and CSV reconcile');
    const shifts = await db.shift.findMany({ where: { eventId: event.id, closedAt: null } });
    for (const shift of shifts)
      await operation('SUPER_ADMIN', 'shift.close', {
        id: shift.id,
        reason: 'End-to-end event completion',
      });
    await operation('SUPER_ADMIN', 'event.close', { eventId: event.id });
    await operation('CASHIER', 'order.create', { ...orderIntent, key: randomUUID() }, 409);
    await operation(
      'PAYMENT_CASHIER',
      'payment.generate',
      { eventId: event.id, stationId: f.stations[3].id, token: replaced.token, key: randomUUID() },
      409,
    );
    pass('Closing snapshot and closed event rejects orders/payments');

    const uiEvent = await operation<{ id: string }>('SUPER_ADMIN', 'event.save', {
      code: `UI-${f.tag}`,
      name: 'Browser acceptance event',
      status: 'OPEN',
    });
    browser = await chromium.launch({
      executablePath:
        process.env.BROWSER_EXECUTABLE ??
        (process.platform === 'win32'
          ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
          : undefined),
      headless: true,
    });
    const contexts: BrowserContext[] = [];
    const browserErrors: string[] = [];
    const externalRequests: string[] = [];
    async function pageFor(role: keyof typeof cookies) {
      const context = await browser!.newContext({ viewport: { width: 1440, height: 1000 } });
      contexts.push(context);
      await context.addCookies([
        {
          name: 'ccida_session',
          value: cookies[role].slice('ccida_session='.length),
          domain: '127.0.0.1',
          path: '/',
          httpOnly: true,
          secure: false,
          sameSite: 'Strict',
        },
      ]);
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== base) {
          externalRequests.push(url.origin);
          return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => browserErrors.push(error.message));
      await page.goto(base);
      await page.locator('.workspace').waitFor();
      return page;
    }
    const regPage = await pageFor('ADMIN');
    await selectContext(regPage, uiEvent.id, f.stations[0].id);
    await regPage.getByLabel('ชื่อผู้ร่วมงาน', { exact: true }).fill('UI acceptance customer');
    await regPage.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await regPage.getByAltText('Customer QR').waitFor();
    await regPage.getByRole('button', { name: 'ปิด', exact: true }).click();
    const uiRegistration = await db.registration.findFirstOrThrow({
      where: { eventId: uiEvent.id, customerName: 'UI acceptance customer' },
      include: { account: { include: { credentials: true } } },
    });
    const uiToken = uiRegistration.account!.credentials[0].token;
    assert.equal(
      await regPage
        .locator('nav')
        .getByRole('button', { name: 'รับชำระเงิน', exact: true })
        .count(),
      0,
    );
    await regPage.setViewportSize({ width: 390, height: 844 });
    await regPage.screenshot({
      path: 'docs/validation/final/registration-mobile.png',
      fullPage: true,
    });
    pass('Browser ADMIN registration, QR card, role navigation and mobile layout');
    const cashierPage = await pageFor('CASHIER');
    await selectContext(cashierPage, uiEvent.id, f.stations[1].id);
    assert.equal(
      await cashierPage
        .locator('nav')
        .getByRole('button', { name: 'รับชำระเงิน', exact: true })
        .count(),
      0,
    );
    await cashierPage.getByRole('button', { name: 'เปิดกะ', exact: true }).click();
    await cashierPage.getByText('กะเปิดแล้ว', { exact: false }).waitFor();
    await cashierPage.getByPlaceholder('ค้นหาสินค้า / รหัสสินค้า').fill(`TEA-${f.tag}`);
    await cashierPage.locator('.product-add').click();
    await cashierPage.locator('.product-add').click();
    await cashierPage.getByRole('button', { name: 'ตรวจสอบ QR และบันทึก' }).click();
    await cashierPage.getByRole('textbox', { name: 'Customer QR' }).fill(uiToken);
    await cashierPage.getByRole('textbox', { name: 'Customer QR' }).press('Enter');
    await cashierPage.getByRole('button', { name: 'ยืนยันบันทึกรายการ', exact: true }).waitFor();
    let dropOnce = true;
    await cashierPage.route('**/api/operations', async (route) => {
      const body = route.request().postDataJSON();
      if (body.action === 'order.create' && dropOnce) {
        dropOnce = false;
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        return route.abort('connectionreset');
      }
      return route.continue();
    });
    await cashierPage.getByRole('button', { name: 'ยืนยันบันทึกรายการ', exact: true }).click();
    await cashierPage.getByText('เซิร์ฟเวอร์ไม่พร้อมใช้งาน', { exact: false }).waitFor();
    assert.equal(await db.order.count({ where: { accountId: uiRegistration.account!.id } }), 1);
    await cashierPage.reload();
    await cashierPage
      .getByRole('button', { name: 'ลองส่งรายการเดิมอีกครั้ง', exact: true })
      .waitFor();
    await cashierPage
      .getByRole('button', { name: 'ลองส่งรายการเดิมอีกครั้ง', exact: true })
      .click();
    await cashierPage.getByText('รับชำระที่จุดชำระเงิน', { exact: false }).waitFor();
    assert.equal(await db.order.count({ where: { accountId: uiRegistration.account!.id } }), 1);
    await cashierPage.setViewportSize({ width: 1024, height: 768 });
    await cashierPage.screenshot({ path: 'docs/validation/final/pos-tablet.png', fullPage: true });
    pass('Browser POS, scanner Enter, lost response, reload and same-key retry without duplicate');
    const secondPage = await pageFor('SECOND_CASHIER');
    await selectContext(secondPage, uiEvent.id, f.stations[2].id);
    await secondPage.getByRole('button', { name: 'เปิดกะ', exact: true }).click();
    await secondPage.getByText('กะเปิดแล้ว', { exact: false }).waitFor();
    await secondPage.getByPlaceholder('ค้นหาสินค้า / รหัสสินค้า').fill(`COFFEE-${f.tag}`);
    await secondPage.locator('.product-add').click();
    await secondPage.getByRole('button', { name: 'ตรวจสอบ QR และบันทึก' }).click();
    await secondPage.getByRole('textbox', { name: 'Customer QR' }).fill(uiToken);
    await secondPage.getByRole('textbox', { name: 'Customer QR' }).press('Enter');
    await secondPage.getByRole('button', { name: 'ยืนยันบันทึกรายการ', exact: true }).click();
    await secondPage.getByText('รับชำระที่จุดชำระเงิน', { exact: false }).waitFor();
    pass('Browser second POS purchase');
    const payPage = await pageFor('PAYMENT_CASHIER');
    await selectContext(payPage, uiEvent.id, f.stations[3].id);
    await payPage.getByRole('button', { name: 'เปิดกะ', exact: true }).click();
    await payPage.getByText('กะเปิดแล้ว', { exact: false }).waitFor();
    await payPage.getByRole('textbox', { name: 'Customer QR' }).fill(uiToken);
    await payPage.getByRole('textbox', { name: 'Customer QR' }).press('Enter');
    await payPage
      .getByRole('button', { name: 'สร้าง QR พร้อมเพย์ตามยอดค้าง', exact: true })
      .click();
    await payPage.getByAltText('PromptPay exact-amount QR').waitFor();
    await payPage.getByLabel('เลขอ้างอิงธนาคาร').fill(randomUUID());
    await payPage
      .getByLabel('รายละเอียดการตรวจสอบหลักฐาน')
      .fill('Checked recipient, 140.00 THB and transfer evidence');
    await payPage.getByRole('checkbox').check();
    await payPage.getByRole('button', { name: 'ยืนยันรับชำระเงิน', exact: true }).click();
    await payPage.getByRole('heading', { name: 'ใบรับชำระเงิน', exact: true }).waitFor();
    await payPage.evaluate(() => {
      window.print = () => {
        throw new Error('Printer unavailable');
      };
    });
    await payPage.getByRole('button', { name: 'พิมพ์ใบเสร็จ 58 มม.', exact: true }).click();
    await payPage.getByRole('alert').getByText('Printer unavailable.', { exact: false }).waitFor();
    assert.equal(
      (await db.customerAccount.findUniqueOrThrow({ where: { id: uiRegistration.account!.id } }))
        .status,
      'SETTLED',
    );
    await payPage.getByRole('button', { name: 'ปิด', exact: true }).click();
    await payPage.getByRole('textbox', { name: 'Customer QR' }).press('Enter');
    await payPage.getByText('ACCOUNT ALREADY SETTLED', { exact: false }).waitFor();
    await payPage.getByRole('button', { name: 'พิมพ์สำเนาใบเสร็จ', exact: true }).click();
    await payPage.getByRole('heading', { name: 'สำเนา / COPY', exact: true }).waitFor();
    await payPage.screenshot({ path: 'docs/validation/final/receipt-copy.png', fullPage: true });
    pass('Browser payment, verified confirmation, printer failure, SETTLED rescan and COPY');
    const superPage = await pageFor('SUPER_ADMIN');
    await selectContext(superPage, uiEvent.id, f.stations[1].id);
    await superPage.locator('nav').getByRole('button', { name: 'ภาพรวม', exact: true }).click();
    await superPage.getByText('RECONCILED', { exact: true }).waitFor();
    await superPage.screenshot({
      path: 'docs/validation/final/dashboard-desktop.png',
      fullPage: true,
    });
    await superPage.locator('nav').getByRole('button', { name: 'รายงาน', exact: true }).click();
    const downloadPromise = superPage.waitForEvent('download');
    await superPage.getByRole('link', { name: 'CSV สรุป', exact: false }).click();
    const download = await downloadPromise;
    await download.saveAs('docs/validation/final/browser-summary.csv');
    await superPage.pdf({
      path: 'docs/validation/final/event-report.pdf',
      format: 'A4',
      preferCSSPageSize: true,
      printBackground: true,
    });
    await payPage.pdf({
      path: 'docs/validation/final/receipt-58mm.pdf',
      width: '58mm',
      height: '250mm',
      printBackground: true,
    });
    const browserSummary = (await (
      await request(`/api/reports?eventId=${uiEvent.id}`, 'SUPER_ADMIN')
    ).json()) as Summary;
    assert.equal(browserSummary.confirmedPaymentSatang, 14000);
    assert.ok(browserSummary.reconciled);
    for (const page of [regPage, cashierPage, secondPage, superPage])
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        'Horizontal page overflow',
      );
    assert.equal(externalRequests.length, 0);
    assert.deepEqual(browserErrors, []);
    pass(
      'Browser dashboard reconciliation, CSV download, responsive widths and zero public Internet requests',
    );
    const manifest = await (await request('/manifest.webmanifest')).json();
    assert.equal(manifest.display, 'standalone');
    const sw = await (await request('/sw.js')).text();
    assert.ok(sw.includes("url.pathname.startsWith('/api/')"));
    pass('PWA manifest and financial API cache exclusion');
    await request('/api/backup', 'CASHIER', { reason: 'Forbidden backup' }, 403);
    const backup = (await (
      await request('/api/backup', 'SUPER_ADMIN', { reason: 'HTTP end-to-end backup' })
    ).json()) as { id: string; size: number };
    const archive = await request(`/api/backup?id=${backup.id}`, 'SUPER_ADMIN');
    assert.equal((await archive.arrayBuffer()).byteLength, backup.size);
    await operation('SUPER_ADMIN', 'backup.schedule', { enabled: true, intervalHours: 24 });
    const worker = () =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [path.resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/backup-worker.ts', '--once'],
          { env: process.env, windowsHide: true, stdio: 'ignore' },
        );
        child.on('error', reject);
        child.on('close', (code) =>
          code === 0 ? resolve() : reject(new Error('Backup worker failed.')),
        );
      });
    await Promise.all([worker(), worker()]);
    const queued = await db.systemSetting.findUniqueOrThrow({
      where: { key: `backup-request:${event.id}` },
    });
    assert.equal((queued.value as { status: string }).status, 'COMPLETE');
    const scheduled = await db.systemSetting.findUniqueOrThrow({
      where: { key: 'backup-schedule' },
    });
    assert.ok((scheduled.value as { lastAt?: string }).lastAt);
    const count = await db.systemSetting.count({ where: { key: { startsWith: 'backup:' } } });
    await worker();
    assert.equal(
      await db.systemSetting.count({ where: { key: { startsWith: 'backup:' } } }),
      count,
    );
    pass(
      'Authenticated streaming backup, concurrent closing/scheduled worker and no repeated schedule',
    );
    for (const context of contexts) await context.close();
    await writeFile(
      'docs/validation/final/results.json',
      JSON.stringify(
        {
          status: 'PASS',
          date: new Date().toISOString(),
          checks: results,
          notes: [
            'All fixture data is isolated in the _test database.',
            'Print failure is a browser simulation; physical paper/printer and a live bank recipient require operational acceptance.',
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    if (browser) await browser.close();
    server.kill();
    await db.$disconnect();
    await writeFile('docs/validation/final/server.log', serverOutput);
  }
}
main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : 'End-to-end failure');
  await writeFile(
    'docs/validation/final/failure.json',
    JSON.stringify(
      { checks: results, error: error instanceof Error ? error.message : 'Unknown error' },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
