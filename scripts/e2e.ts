import '../tests/setup';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, type Page, type BrowserContext } from 'playwright';
import { fixture, assignFixtureEvent } from '../tests/helpers';
import { salesFixture } from '../tests/sales-helpers';
import { orderAction } from '../src/lib/orders';
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
import { testPort } from './test-port';
import { decodePrintedCode } from '../tests/image-decode';
import { BarcodeFormat } from '@zxing/library';
import sharp from 'sharp';

let base = '';
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
  await page.waitForFunction(() => {
    if (document.querySelector('.staff-event')) return true;
    if (['/pos', '/payments', '/register'].includes(location.pathname))
      return !!document.querySelector('.shift-bar');
    const selector = document.querySelector<HTMLSelectElement>('select[aria-label="กิจกรรม"]');
    return !!selector?.value && !selector.disabled;
  });
  const operator = await page.evaluate(
    async () =>
      (await (await fetch('/api/auth')).json()) as {
        id: string;
        username: string;
        displayName: string;
        roleName: RoleName;
      },
  );
  if (operator.roleName !== 'SUPER_ADMIN') {
    await operation('SUPER_ADMIN', 'user.save', {
      ...operator,
      active: true,
      assignedEventId: eventId,
    });
  }
  // Station preferences remain fixture-only; event selection is visible in production.
  await page.evaluate(
    async ({ eventId, stationId }) => {
      const user = await (await fetch('/api/auth')).json();
      sessionStorage.setItem(`ccida:event:${user.id}`, eventId);
      sessionStorage.setItem(`ccida:analytics-event:${user.id}`, eventId);
      sessionStorage.setItem(`ccida:station:${user.id}`, stationId);
    },
    { eventId, stationId },
  );
  const resolved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/data' &&
      new URL(response.url()).searchParams.get('view') === 'events',
  );
  await page.reload();
  assert.equal((await resolved).status(), 200);
  await page.waitForFunction((id) => {
    const selector = document.querySelector<HTMLSelectElement>('select[aria-label="กิจกรรม"]');
    return (
      selector?.value === id ||
      document.querySelector('.staff-event')?.getAttribute('data-event-id') === id
    );
  }, eventId);
  if (
    operator.roleName === 'SUPER_ADMIN' &&
    ['/pos', '/payments', '/register'].includes(new URL(page.url()).pathname)
  )
    await page.locator('.shift-bar').waitFor();
}
async function main() {
  const port = await testPort();
  base = `http://127.0.0.1:${port}`;
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
  let receiptSettingsBefore: Record<string, string> | undefined;
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
    const productionPolicy = (await fetch(base)).headers.get('content-security-policy');
    assert.ok(productionPolicy && !productionPolicy.includes("'unsafe-eval'"));
    pass('Production CSP keeps eval disabled');
    const f = await fixture();
    const second = await db.user.create({
      data: {
        username: `${f.tag}-ui-second`,
        displayName: 'Second cashier',
        roleName: 'CASHIER',
        passwordHash: hashPassword('test-password-12345'),
      },
    });
    for (const role of [
      'SUPER_ADMIN',
      'ADMIN',
      'CASHIER',
      'PAYMENT_CASHIER',
      'REGISTRATION_CASHIER',
    ] as const) {
      const u = await db.user.findUniqueOrThrow({ where: { id: f.actors[role].id } });
      await signIn(role, u.username);
    }
    await signIn('SECOND_CASHIER', second.username);
    pass('All five roles authenticate with protected cookies');
    await request('/api/data?view=users', 'CASHIER', undefined, 403);
    await request('/api/data?view=audit', undefined, undefined, 401);
    await operation('CASHIER', 'payment.confirm', {}, 403);
    await operation('ADMIN', 'order.create', {}, 403);
    await operation('PAYMENT_CASHIER', 'registration.create', {}, 403);
    await operation('REGISTRATION_CASHIER', 'order.create', {}, 403);
    await operation('REGISTRATION_CASHIER', 'payment.confirm', {}, 403);
    await request('/api/reports?eventId=' + randomUUID(), 'ADMIN', undefined, 403);
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
    await assignFixtureEvent(f, event.id);
    await db.user.update({ where: { id: second.id }, data: { assignedEventId: event.id } });
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

    const legacyEvent = await operation<{ id: string }>('SUPER_ADMIN', 'event.save', {
      code: `LEGACY-${f.tag}`,
      name: 'Specialized super administrator shift regression',
      status: 'OPEN',
    });
    const legacyShift = await operation<{ id: string }>('SUPER_ADMIN', 'shift.open', {
      eventId: legacyEvent.id,
      stationId: f.stations[0].id,
    });
    const assigned = await operation<{ event: { id: string }; station: { id: string } }>(
      'SUPER_ADMIN',
      'context.resolve',
      {},
    );
    assert.equal(assigned.station.id, f.stations[0].id);
    const legacyCustomer = await operation<PrintDto>('SUPER_ADMIN', 'registration.create', {
      eventId: assigned.event.id,
      stationId: assigned.station.id,
      customerName: 'Specialized shift acceptance',
    });
    const legacyOrder = await operation<{ id: string; shiftId: string; totalSatang: number }>(
      'SUPER_ADMIN',
      'order.create',
      {
        eventId: assigned.event.id,
        stationId: assigned.station.id,
        token: legacyCustomer.token,
        key: randomUUID(),
        items: [{ productId: tea.id, quantity: 1 }],
      },
    );
    assert.equal(legacyOrder.totalSatang, 4000);
    assert.equal(legacyOrder.shiftId, legacyShift.id);
    const legacyPayment = await operation<PaymentDto>('SUPER_ADMIN', 'payment.generate', {
      eventId: assigned.event.id,
      stationId: assigned.station.id,
      token: legacyCustomer.token,
      key: randomUUID(),
    });
    await operation('SUPER_ADMIN', 'payment.confirm', {
      ...confirmation,
      paymentId: legacyPayment.id,
      stationId: assigned.station.id,
      key: randomUUID(),
      reference: randomUUID(),
    });
    assert.equal(
      (await db.station.findUniqueOrThrow({ where: { id: assigned.station.id } })).type,
      'REGISTRATION',
    );
    assert.equal(
      (await db.payment.findUniqueOrThrow({ where: { id: legacyPayment.id } })).shiftId,
      legacyShift.id,
    );
    await operation('SUPER_ADMIN', 'shift.close', { id: legacyShift.id });
    await operation('SUPER_ADMIN', 'event.close', { eventId: legacyEvent.id });
    pass(
      'SUPER_ADMIN saves and settles a sale using an existing registration shift without reassigning history',
    );

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
    await regPage.waitForURL(base + '/dashboard');
    await regPage.locator('.kpis').waitFor();
    assert.equal(
      await regPage.locator('nav').getByRole('button', { name: 'ภาพรวม', exact: true }).count(),
      1,
    );
    await regPage.locator('nav').getByRole('button', { name: 'ลงทะเบียน', exact: true }).click();
    await regPage.waitForURL(base + '/register');
    pass('ADMIN lands on its authorized aggregate dashboard');

    const registrationUser = await db.user.findUniqueOrThrow({
      where: { id: f.actors.REGISTRATION_CASHIER.id },
    });
    const loginContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    contexts.push(loginContext);
    const loginPage = await loginContext.newPage();
    const registrationDashboardRequests: string[] = [];
    loginPage.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/dashboard')
        registrationDashboardRequests.push(request.url());
    });
    await loginPage.goto(base);
    for (const [width, height, name] of [
      [1366, 900, 'desktop'],
      [390, 844, 'mobile'],
    ] as const) {
      await loginPage.setViewportSize({ width, height });
      const centered = await loginPage.locator('.login-card').evaluate((card) => {
        const box = card.getBoundingClientRect();
        return {
          x: Math.abs((box.left + box.right) / 2 - innerWidth / 2),
          y: Math.abs((box.top + box.bottom) / 2 - innerHeight / 2),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.ok(
        centered.x < 1 && centered.y < 1 && !centered.overflow,
        'Login card must be centered without overflow',
      );
      await loginPage.screenshot({
        path: `docs/validation/final/login-${name}.png`,
        fullPage: true,
      });
    }
    await loginPage.locator('input[name="username"]').fill(registrationUser.username);
    await loginPage.locator('input[name="password"]').fill('test-password-12345');
    await loginPage.getByRole('button', { name: 'เข้าสู่ระบบ →', exact: true }).click();
    await loginPage.waitForURL(base + '/register');
    await selectContext(loginPage, uiEvent.id, f.stations[0].id);
    assert.equal(await loginPage.locator('nav, .sidebar').count(), 0);
    await loginPage
      .getByLabel('ชื่อผู้ร่วมงาน', { exact: true })
      .fill('Registration-only cashier acceptance');
    await loginPage.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await loginPage.getByAltText('Customer QR').waitFor();
    await loginPage.getByRole('button', { name: 'ปิด', exact: true }).click();
    await loginPage.goto(base + '/dashboard');
    await loginPage.waitForURL(base + '/register');
    await loginPage.locator('.registration-only').waitFor();
    assert.equal(await loginPage.locator('.kpis, nav, .sidebar').count(), 0);
    await loginPage.goto(base + '/pos');
    await loginPage.waitForURL(base + '/register');
    assert.equal(await loginPage.locator('.product-grid').count(), 0);
    for (const [width, height, name] of [
      [1366, 900, 'desktop'],
      [900, 900, 'tablet'],
      [390, 844, 'mobile'],
    ] as const) {
      await loginPage.setViewportSize({ width, height });
      await loginPage.getByLabel('ชื่อผู้ร่วมงาน', { exact: true }).waitFor();
      assert.equal(await loginPage.locator('nav, .sidebar').count(), 0);
      const layout = await loginPage.locator('.workspace').evaluate((workspace) => {
        const box = workspace.getBoundingClientRect();
        return {
          left: box.left,
          width: box.width,
          viewport: innerWidth,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.ok(Math.abs(layout.left) < 1 && Math.abs(layout.width - layout.viewport) < 1);
      assert.ok(!layout.overflow, 'Registration-only page must fit without horizontal overflow');
      await loginPage.screenshot({
        path: `docs/validation/final/registration-only-${name}.png`,
        fullPage: true,
      });
    }
    assert.equal(registrationDashboardRequests.length, 0);
    await loginPage.screenshot({
      path: 'docs/validation/final/registration-cashier.png',
      fullPage: true,
    });
    pass(
      'Centered login; registration cashier lands directly on a full-width page with no menu/dashboard at desktop/tablet/mobile',
    );
    await selectContext(regPage, uiEvent.id, f.stations[0].id);
    await regPage.getByLabel('ชื่อผู้ร่วมงาน', { exact: true }).fill('UI acceptance customer');
    await regPage.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await regPage.getByAltText('Customer QR').waitFor();
    await regPage.emulateMedia({ media: 'print' });
    assert.equal(await regPage.locator('.qr-event-name').innerText(), 'Browser acceptance event');
    assert.equal(await regPage.locator('.qr-customer-name').innerText(), 'UI acceptance customer');
    assert.equal(await regPage.locator('.qr-registration-instructions li').count(), 3);
    const printedCustomerQr = await regPage.getByAltText('Customer QR').evaluate(async (image) => {
      const qr = image as HTMLImageElement;
      await qr.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = Math.round((qr.clientWidth * 203) / 96);
      const context = canvas.getContext('2d')!;
      context.imageSmoothingEnabled = false;
      context.drawImage(qr, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    });
    const cardRegistration = await db.registration.findFirstOrThrow({
      where: { eventId: uiEvent.id, customerName: 'UI acceptance customer' },
      include: { account: { include: { credentials: true } } },
    });
    assert.equal(
      decodePrintedCode(printedCustomerQr, BarcodeFormat.QR_CODE),
      cardRegistration.account!.credentials[0].token,
    );
    const qrLayout = await regPage.locator('.qr-card').evaluate((card) => {
      const image = card.querySelector('img')!;
      const box = card.getBoundingClientRect();
      const qr = image.getBoundingClientRect();
      return {
        cardWidth: box.width,
        cardHeight: box.height,
        qrWidth: qr.width,
        centerOffset: Math.abs((qr.left + qr.right) / 2 - (box.left + box.right) / 2),
        verticalOffset: Math.abs((qr.top + qr.bottom) / 2 - (box.top + box.bottom) / 2),
        overflow: card.scrollWidth > card.clientWidth,
      };
    });
    assert.ok(qrLayout.centerOffset < 1, 'QR must be horizontally centered');
    assert.ok(qrLayout.verticalOffset < 1, 'QR must be vertically centered');
    assert.ok(!qrLayout.overflow, 'QR card must not clip content');
    assert.ok(Math.abs(qrLayout.cardWidth - (72 * 96) / 25.4) < 1);
    assert.ok(Math.abs(qrLayout.cardHeight - (112 * 96) / 25.4) < 1);
    const qrPdf = await regPage.pdf({
      path: 'docs/validation/final/customer-qr-80mm.pdf',
      preferCSSPageSize: true,
    });
    const qrPdfText = qrPdf.toString('latin1');
    assert.ok(qrPdfText.includes('/Subtype /Image'), 'Customer QR PDF must contain its image');
    assert.equal((qrPdfText.match(/\/Type\s*\/Page\b/g) ?? []).length, 1);
    const qrMediaBox = qrPdfText.match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);
    assert.ok(qrMediaBox);
    assert.ok(Math.abs(Number(qrMediaBox[1]) - (80 * 72) / 25.4) < 1);
    assert.ok(Math.abs(Number(qrMediaBox[2]) - (120 * 72) / 25.4) < 1);
    await writeFile(
      'docs/validation/final/qr-print-layout.json',
      JSON.stringify(
        {
          status: 'PASS',
          ...qrLayout,
          paperWidthMm: 80,
          paperLengthMm: 120,
          pages: 1,
          mediaBoxPoints: qrMediaBox.slice(1).map(Number),
        },
        null,
        2,
      ),
    );
    await regPage.emulateMedia({ media: 'screen' });
    await regPage.locator('.qr-card').screenshot({
      path: 'docs/validation/final/registration-card-design-80mm.png',
    });
    await regPage.screenshot({
      path: 'docs/validation/final/customer-qr-80mm.png',
      fullPage: true,
    });
    pass(
      'Registration card includes event/customer/instructions, centered 80 mm QR and 203 dpi decoding',
    );
    await regPage.evaluate(() => {
      window.print = () => {
        throw new Error('Printer unavailable');
      };
    });
    await regPage.getByRole('button', { name: 'พิมพ์บัตร QR', exact: true }).click();
    await regPage.getByRole('alert').getByText('Printer unavailable.', { exact: false }).waitFor();
    await regPage.getByRole('button', { name: 'พิมพ์บัตร QR', exact: true }).click();
    await regPage.getByRole('button', { name: 'ปิด', exact: true }).click();
    assert.equal(await regPage.getByLabel('ชื่อผู้ร่วมงาน', { exact: true }).inputValue(), '');
    await operation('SUPER_ADMIN', 'event.save', {
      id: uiEvent.id,
      code: f.tag.padEnd(40, 'W'),
      name: 'W'.repeat(160),
      status: 'OPEN',
    });
    await regPage.getByLabel('ชื่อผู้ร่วมงาน', { exact: true }).fill('W'.repeat(120));
    await regPage.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await regPage.getByAltText('Customer QR').waitFor();
    await regPage.emulateMedia({ media: 'print' });
    const longQrLayout = await regPage.locator('.qr-card').evaluate((card) => {
      const box = card.getBoundingClientRect();
      const name = card.querySelector('.qr-customer-name')!.getBoundingClientRect();
      const event = card.querySelector('.qr-event-name')!.getBoundingClientRect();
      const details = card.querySelector('.qr-card-details')!.getBoundingClientRect();
      const footer = card.querySelector('.qr-card-footer')!.getBoundingClientRect();
      const qr = card.querySelector('img')!.getBoundingClientRect();
      return {
        centerX: Math.abs((qr.left + qr.right - box.left - box.right) / 2),
        centerY: Math.abs((qr.top + qr.bottom - box.top - box.bottom) / 2),
        cardHeight: box.height,
        nameFits:
          name.left >= box.left - 1 &&
          name.right <= box.right + 1 &&
          name.top > qr.bottom &&
          name.bottom <= box.bottom + 1,
        eventFits: event.top >= box.top - 1 && details.bottom < qr.top,
        footerFits: footer.top > qr.bottom && footer.bottom <= box.bottom + 1,
        overflow: card.scrollWidth > card.clientWidth,
      };
    });
    assert.ok(longQrLayout.centerX < 1 && longQrLayout.centerY < 1);
    assert.ok(Math.abs(longQrLayout.cardHeight - (112 * 96) / 25.4) < 1);
    await writeFile(
      'docs/validation/final/registration-card-long-layout.json',
      JSON.stringify(longQrLayout, null, 2),
    );
    assert.ok(
      longQrLayout.nameFits,
      'Maximum-length customer names must fit below the centered QR',
    );
    assert.ok(
      longQrLayout.eventFits,
      'Maximum-length event name/code must fit above the centered QR',
    );
    assert.ok(
      longQrLayout.footerFits && !longQrLayout.overflow,
      'Instructions must fit without clipping',
    );
    const longQrPdf = await regPage.pdf({
      path: 'docs/validation/final/customer-qr-long-name-80mm.pdf',
      preferCSSPageSize: true,
    });
    assert.equal((longQrPdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length, 1);
    await operation('SUPER_ADMIN', 'event.save', {
      id: uiEvent.id,
      code: `UI-${f.tag}`,
      name: 'Browser acceptance event',
      status: 'OPEN',
    });
    await regPage.emulateMedia({ media: 'screen' });
    await regPage.getByRole('button', { name: 'ปิด', exact: true }).click();
    const uiRegistration = await db.registration.findFirstOrThrow({
      where: { eventId: uiEvent.id, customerName: 'UI acceptance customer' },
      include: { account: { include: { credentials: true } } },
    });
    const uiToken = uiRegistration.account!.credentials[0].token;
    assert.equal(
      await db.auditLog.count({
        where: { entityId: uiRegistration.account!.id, action: 'QR_REPRINT' },
      }),
      2,
    );
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
    await cashierPage.waitForURL(base + '/pos');
    assert.equal(await cashierPage.locator('nav, .sidebar').count(), 0);
    await cashierPage.goto(base + '/dashboard');
    await cashierPage.waitForURL(base + '/pos');
    await selectContext(cashierPage, uiEvent.id, f.stations[1].id);
    assert.equal(
      await cashierPage
        .locator('nav')
        .getByRole('button', { name: 'รับชำระเงิน', exact: true })
        .count(),
      0,
    );
    assert.equal(await cashierPage.getByRole('button', { name: 'เปิดกะ', exact: true }).count(), 0);
    assert.equal(await cashierPage.getByRole('button', { name: 'ปิดกะ', exact: true }).count(), 0);
    await cashierPage.getByPlaceholder('ค้นหาสินค้า / รหัสสินค้า').fill(`TEA-${f.tag}`);
    await cashierPage.locator('.product-add').click();
    await cashierPage.locator('.product-add').click();
    const posLayouts = [];
    for (const [width, height, label] of [
      [1920, 1080, 'wide'],
      [1366, 768, 'desktop'],
      [1024, 768, 'tablet'],
    ] as const) {
      await cashierPage.setViewportSize({ width, height });
      const layout = await cashierPage.locator('.pos-layout').evaluate((pos) => {
        const cart = pos.querySelector('.cart')!.getBoundingClientRect();
        const cta = pos.querySelector('.checkout')!.getBoundingClientRect();
        return {
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          cartBottom: cart.bottom,
          checkoutBottom: cta.bottom,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.ok(
        !layout.overflow && layout.checkoutBottom <= height + 1 && layout.cartBottom <= height + 1,
        'Cart and checkout must fit the desktop viewport',
      );
      posLayouts.push({ label, ...layout });
    }
    await cashierPage.setViewportSize({ width: 1440, height: 900 });
    await cashierPage.screenshot({
      path: 'docs/validation/final/pos-desktop-redesign.png',
      fullPage: false,
    });
    const modalStarted = Date.now();
    await cashierPage.getByRole('button', { name: 'ตรวจสอบ QR และบันทึก' }).click();
    const checkoutModal = cashierPage.getByRole('dialog', {
      name: 'สแกน QR ผู้ร่วมงาน',
      exact: true,
    });
    await checkoutModal.waitFor();
    const modalOpenMs = Date.now() - modalStarted;
    assert.ok(
      await cashierPage
        .getByRole('textbox', { name: 'Customer QR' })
        .evaluate((input) => document.activeElement === input),
      'Opening QR checkout must immediately focus the scanner',
    );
    const modalBox = await checkoutModal.evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect();
      return {
        centerX: Math.abs((rect.left + rect.right) / 2 - innerWidth / 2),
        centerY: Math.abs((rect.top + rect.bottom) / 2 - innerHeight / 2),
        fits:
          rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth,
      };
    });
    assert.ok(
      modalBox.centerX < 1 && modalBox.centerY < 1 && modalBox.fits,
      'QR checkout must be a centered viewport dialog',
    );
    await cashierPage.keyboard.press('Escape');
    await checkoutModal.waitFor({ state: 'hidden' });
    assert.equal(await cashierPage.locator('.cart .qty b').innerText(), '2');
    await cashierPage.getByRole('button', { name: 'ตรวจสอบ QR และบันทึก' }).click();
    const qrBackgroundRequests: string[] = [];
    const trackQrReads = (request: import('playwright').Request) => {
      if (new URL(request.url()).pathname === '/api/data') qrBackgroundRequests.push(request.url());
    };
    cashierPage.on('request', trackQrReads);
    await cashierPage.getByRole('textbox', { name: 'Customer QR' }).fill(uiToken);
    await cashierPage.getByRole('textbox', { name: 'Customer QR' }).press('Enter');
    await cashierPage.getByRole('button', { name: 'ยืนยันบันทึกรายการ', exact: true }).waitFor();
    cashierPage.off('request', trackQrReads);
    assert.equal(
      qrBackgroundRequests.length,
      0,
      'QR lookup must not refresh the catalog, events or sale history',
    );
    assert.equal(await db.order.count({ where: { accountId: uiRegistration.account!.id } }), 0);
    await cashierPage.screenshot({
      path: 'docs/validation/final/pos-qr-modal.png',
      fullPage: false,
    });
    await writeFile(
      'docs/validation/final/pos-layout.json',
      JSON.stringify(
        { status: 'PASS', posLayouts, modalOpenMs, modalBox, qrBackgroundRequests: 0 },
        null,
        2,
      ),
    );
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
    await cashierPage.keyboard.press('Escape');
    assert.ok(
      await checkoutModal.isVisible(),
      'Unknown checkout must keep its recovery modal open',
    );
    assert.equal(await db.order.count({ where: { accountId: uiRegistration.account!.id } }), 1);
    await cashierPage.context().clearCookies();
    await cashierPage
      .getByRole('button', { name: 'ลองส่งรายการเดิมอีกครั้ง', exact: true })
      .click();
    await cashierPage.locator('.login-form').waitFor();
    const cashierUser = await db.user.findUniqueOrThrow({ where: { id: f.actors.CASHIER.id } });
    await cashierPage.locator('input[name=username]').fill(cashierUser.username);
    await cashierPage.locator('input[name=password]').fill('test-password-12345');
    await cashierPage.locator('.login-form button.primary').click();
    await cashierPage
      .getByRole('button', { name: 'ลองส่งรายการเดิมอีกครั้ง', exact: true })
      .waitFor();
    pass('Unknown checkout survives authentication loss and sign-in');
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
    await cashierPage.evaluate(() => window.scrollTo(0, 0));
    await cashierPage.screenshot({ path: 'docs/validation/final/pos-tablet.png', fullPage: false });
    pass('Browser POS, scanner Enter, lost response, reload and same-key retry without duplicate');
    const secondPage = await pageFor('SECOND_CASHIER');
    await selectContext(secondPage, uiEvent.id, f.stations[2].id);
    assert.equal(await secondPage.locator('.shift-bar').count(), 0);
    await secondPage.getByPlaceholder('ค้นหาสินค้า / รหัสสินค้า').fill(`COFFEE-${f.tag}`);
    await secondPage.locator('.product-add').click();
    await secondPage.getByRole('button', { name: 'ตรวจสอบ QR และบันทึก' }).click();
    await secondPage.getByRole('textbox', { name: 'Customer QR' }).fill(uiToken);
    await secondPage.getByRole('textbox', { name: 'Customer QR' }).press('Enter');
    await secondPage.getByRole('button', { name: 'ยืนยันบันทึกรายการ', exact: true }).click();
    await secondPage.getByText('รับชำระที่จุดชำระเงิน', { exact: false }).waitFor();
    pass('Browser second POS purchase');
    const payPage = await pageFor('PAYMENT_CASHIER');
    await payPage.waitForURL(base + '/payments');
    assert.equal(await payPage.locator('nav, .sidebar, .kpis').count(), 0);
    await selectContext(payPage, uiEvent.id, f.stations[3].id);
    assert.equal(await payPage.locator('.shift-bar').count(), 0);
    assert.equal(await payPage.getByRole('combobox', { name: 'กิจกรรม', exact: true }).count(), 0);
    await payPage.getByRole('textbox', { name: 'Customer QR' }).fill(uiToken);
    await payPage.getByRole('textbox', { name: 'Customer QR' }).press('Enter');
    const retriedKeys: Record<string, string[]> = { 'payment.generate': [], 'payment.confirm': [] };
    const dropped = new Set<string>();
    await payPage.route('**/api/operations', async (route) => {
      const body = route.request().postDataJSON();
      if (body.action in retriedKeys) {
        retriedKeys[body.action].push(body.input.key);
        if (!dropped.has(body.action)) {
          dropped.add(body.action);
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          return route.abort('connectionreset');
        }
      }
      return route.continue();
    });
    await payPage
      .getByRole('button', { name: 'สร้าง QR พร้อมเพย์ตามยอดค้าง', exact: true })
      .click();
    await payPage.getByText('เซิร์ฟเวอร์ไม่พร้อมใช้งาน', { exact: false }).waitFor();
    await payPage.reload();
    await payPage.getByRole('button', { name: 'ลองสร้าง QR ด้วยรายการเดิม', exact: true }).click();
    await payPage.getByAltText('PromptPay exact-amount QR').waitFor();
    assert.equal(await db.payment.count({ where: { accountId: uiRegistration.account!.id } }), 1);
    assert.equal(new Set(retriedKeys['payment.generate']).size, 1);
    pass('Payment QR lost response, reload and original-key recovery');
    const paymentLayouts = [];
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await payPage.setViewportSize(viewport);
      const layout = await payPage.evaluate(() => {
        const scan = document.querySelector('.payment-scan')!.getBoundingClientRect();
        const confirm = document.querySelector('.payment-confirm')!.getBoundingClientRect();
        const qr = document.querySelector('.payment-qr-image')!.getBoundingClientRect();
        const checkbox = document.querySelector('.payment-verified input')!.getBoundingClientRect();
        const verified = document.querySelector('.payment-verified')!;
        return {
          width: innerWidth,
          height: innerHeight,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          scanTop: scan.top,
          confirmBottom: confirm.bottom,
          qrWidth: qr.width,
          checkboxWidth: checkbox.width,
          evidenceOverflow: verified.scrollWidth > verified.clientWidth + 1,
          historyClosed: !document.querySelector<HTMLDetailsElement>('.payment-history')!.open,
          reprintClosed:
            !document.querySelector<HTMLDetailsElement>('.receipt-reprint-panel')!.open,
        };
      });
      assert.equal(layout.overflow, false);
      assert.ok(layout.historyClosed && layout.reprintClosed);
      assert.ok(layout.qrWidth > 150);
      assert.ok(layout.checkboxWidth <= 20 && !layout.evidenceOverflow);
      if (viewport.width >= 1366) assert.ok(layout.confirmBottom < viewport.height);
      paymentLayouts.push(layout);
      await payPage.screenshot({
        path: `docs/validation/final/payment-workspace-${viewport.width}.png`,
        fullPage: true,
      });
    }
    await writeFile(
      'docs/validation/final/payment-layout.json',
      JSON.stringify(paymentLayouts, null, 2),
    );
    await payPage.setViewportSize({ width: 1366, height: 900 });
    pass(
      'Payment-only workspace has no menu or dashboard; scan, QR, evidence and collapsed utilities fit desktop/tablet/mobile',
    );
    receiptSettingsBefore = (await (
      await request('/api/data?view=settings', 'SUPER_ADMIN')
    ).json()) as Record<string, string>;
    const settingsPage = await pageFor('SUPER_ADMIN');
    await settingsPage.locator('nav').getByRole('button', { name: 'ตั้งค่า', exact: true }).click();
    const receiptSettingsPanel = settingsPage
      .locator('.panel')
      .filter({ has: settingsPage.getByLabel('ชื่อหน่วยงานบนใบเสร็จ', { exact: true }) });
    await settingsPage.waitForFunction(
      () =>
        !!(document.querySelector('input[name="organization"]') as HTMLInputElement | null)?.value,
    );
    await settingsPage
      .getByLabel('ข้อความหัวใบเสร็จ', { exact: true })
      .fill('CCIDA EVENT\nPayment receipt');
    await settingsPage
      .getByLabel('ข้อความท้ายใบเสร็จ', { exact: true })
      .fill('Thank you for attending');
    await settingsPage
      .getByLabel('ข้อมูล QR ท้ายใบเสร็จ (URL หรือข้อความ)', { exact: true })
      .fill('https://ccida.test/feedback');
    await settingsPage.getByLabel('คำอธิบาย QR ท้ายใบเสร็จ', { exact: true }).fill('Feedback');
    const settingsSaved = settingsPage.waitForResponse(
      (response) =>
        response.url().endsWith('/api/operations') &&
        response.request().postDataJSON()?.action === 'settings.save',
    );
    await receiptSettingsPanel.getByRole('button', { name: 'บันทึก', exact: true }).click();
    assert.equal((await settingsSaved).status(), 200);
    await settingsPage.reload();
    await settingsPage.waitForFunction(
      () =>
        (document.querySelector('textarea[name="receiptQrValue"]') as HTMLTextAreaElement | null)
          ?.value === 'https://ccida.test/feedback',
    );
    const acceptanceLogo = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="160"><rect width="360" height="160" fill="white"/><rect x="4" y="4" width="352" height="152" rx="12" fill="none" stroke="black" stroke-width="6"/><text x="180" y="104" text-anchor="middle" font-family="Arial" font-size="54" font-weight="bold">TEST LOGO</text></svg>',
      ),
    )
      .png()
      .toBuffer();
    await settingsPage.getByLabel('อัปโหลดโลโก้ใบเสร็จ', { exact: true }).setInputFiles({
      name: 'acceptance-logo.png',
      mimeType: 'image/png',
      buffer: acceptanceLogo,
    });
    await settingsPage.waitForFunction(() => {
      const form = document.querySelector('.receipt-logo-settings');
      if (form?.querySelector('[role="alert"]'))
        throw new Error('Receipt logo preparation failed.');
      return !(form?.querySelector('button.primary') as HTMLButtonElement | null)?.disabled;
    });
    const logoSaved = settingsPage.waitForResponse(
      (response) =>
        response.url().endsWith('/api/operations') &&
        response.request().postDataJSON()?.action === 'settings.save',
    );
    await settingsPage.getByRole('button', { name: 'บันทึกโลโก้', exact: true }).click();
    assert.equal((await logoSaved).status(), 200);
    await settingsPage.reload();
    await settingsPage.getByAltText('ตัวอย่างโลโก้ใบเสร็จ', { exact: true }).waitFor();
    assert.ok(
      await settingsPage
        .getByAltText('ตัวอย่างโลโก้ใบเสร็จ', { exact: true })
        .evaluate(async (image) => {
          await (image as HTMLImageElement).decode();
          return (image as HTMLImageElement).naturalWidth > 0;
        }),
    );
    pass('Super Admin uploads and saves a receipt logo locally; preview persists after reload');
    pass(
      'Receipt header, footer and custom QR settings persist through the production settings page',
    );
    const pendingForPrint = await db.payment.findFirstOrThrow({
      where: { accountId: uiRegistration.account!.id },
    });
    await payPage
      .locator('.payment-qr')
      .getByRole('button', { name: 'พิมพ์ QR พร้อมเพย์', exact: true })
      .click();
    const payPrintCard = payPage.locator('.qr-print-overlay .qr-card');
    await payPrintCard.waitFor();
    await payPage.emulateMedia({ media: 'print' });
    const payQrLayout = await payPrintCard.evaluate((card) => {
      const box = card.getBoundingClientRect();
      const qr = card.querySelector('img')!.getBoundingClientRect();
      return {
        horizontal: Math.abs((qr.left + qr.right - box.left - box.right) / 2),
        vertical: Math.abs((qr.top + qr.bottom - box.top - box.bottom) / 2),
        overflow: card.scrollWidth > card.clientWidth || card.scrollHeight > card.clientHeight + 1,
      };
    });
    assert.ok(payQrLayout.horizontal < 1 && payQrLayout.vertical < 1 && !payQrLayout.overflow);
    const payQrPdf = await payPage.pdf({
      path: 'docs/validation/final/promptpay-qr-80mm.pdf',
      preferCSSPageSize: true,
    });
    const payQrPdfText = payQrPdf.toString('latin1');
    assert.ok(payQrPdfText.includes('/Subtype /Image'), 'PromptPay PDF must contain its QR image');
    assert.equal((payQrPdfText.match(/\/Type\s*\/Page\b/g) ?? []).length, 1);
    const payQrMediaBox = payQrPdfText.match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);
    assert.ok(payQrMediaBox);
    assert.ok(Math.abs(Number(payQrMediaBox[1]) - (80 * 72) / 25.4) < 1);
    assert.ok(Math.abs(Number(payQrMediaBox[2]) - (120 * 72) / 25.4) < 1);
    await payPage.emulateMedia({ media: 'screen' });
    await payPage.screenshot({
      path: 'docs/validation/final/promptpay-qr-80mm.png',
      fullPage: true,
    });
    await payPage.evaluate(() => {
      window.print = () => {
        throw new Error('Printer unavailable');
      };
    });
    await payPage.getByRole('button', { name: 'พิมพ์ QR พร้อมเพย์ 80 มม.', exact: true }).click();
    await payPage.getByRole('alert').getByText('Printer unavailable.', { exact: false }).waitFor();
    assert.equal(
      (await db.payment.findUniqueOrThrow({ where: { id: pendingForPrint.id } })).status,
      'AWAITING_CONFIRMATION',
    );
    assert.equal(await db.payment.count({ where: { accountId: uiRegistration.account!.id } }), 1);
    assert.equal(await db.receipt.count({ where: { paymentId: pendingForPrint.id } }), 0);
    assert.equal(
      await db.auditLog.count({
        where: { action: 'PAYMENT_QR_PRINT', entityId: pendingForPrint.id },
      }),
      2,
    );
    await payPage.getByRole('button', { name: 'ปิด', exact: true }).click();
    pass(
      'PromptPay QR printing uses centered 80 mm layout, audit and preserved pending payment after printer failure',
    );
    const longPrintEvent = await operation<{ id: string }>('SUPER_ADMIN', 'event.save', {
      code: `PRINT-${f.tag}`,
      name: 'Maximum-length PromptPay print validation',
      status: 'OPEN',
    });
    const longPrintContext = await operation<{ event: { id: string }; station: { id: string } }>(
      'SUPER_ADMIN',
      'context.resolve',
      { eventId: longPrintEvent.id },
    );
    const longPrintShift = await operation<{ id: string }>('SUPER_ADMIN', 'shift.open', {
      eventId: longPrintEvent.id,
      stationId: longPrintContext.station.id,
    });
    const longPrintCustomer = await operation<PrintDto>('SUPER_ADMIN', 'registration.create', {
      eventId: longPrintEvent.id,
      stationId: longPrintContext.station.id,
      customerName: 'W'.repeat(120),
    });
    const longPrintOrder = await operation<OrderDto>('SUPER_ADMIN', 'order.create', {
      eventId: longPrintEvent.id,
      stationId: longPrintContext.station.id,
      token: longPrintCustomer.token,
      key: randomUUID(),
      items: [{ productId: tea.id, quantity: 1 }],
    });
    const originalRecipient = await (
      await request('/api/data?view=promptpay', 'SUPER_ADMIN')
    ).json();
    let longPrintPayment: PaymentDto;
    try {
      await operation('SUPER_ADMIN', 'promptpay.save', {
        ...originalRecipient,
        displayName: 'W'.repeat(120),
      });
      longPrintPayment = await operation<PaymentDto>('SUPER_ADMIN', 'payment.generate', {
        eventId: longPrintEvent.id,
        stationId: longPrintContext.station.id,
        token: longPrintCustomer.token,
        key: randomUUID(),
      });
    } finally {
      await operation('SUPER_ADMIN', 'promptpay.save', originalRecipient);
    }
    const longPrintPage = await pageFor('SUPER_ADMIN');
    await longPrintPage
      .locator('nav')
      .getByRole('button', { name: 'รับชำระเงิน', exact: true })
      .click();
    await longPrintPage.locator('.payment-history > summary').click();
    await longPrintPage
      .locator('tr')
      .filter({ hasText: longPrintPayment.number })
      .getByRole('button', { name: 'พิมพ์ QR พร้อมเพย์', exact: true })
      .click();
    await longPrintPage.locator('.qr-print-overlay .qr-card').waitFor();
    await longPrintPage.emulateMedia({ media: 'print' });
    const maximumLayout = await longPrintPage
      .locator('.qr-print-overlay .qr-card')
      .evaluate((card) => {
        const box = card.getBoundingClientRect();
        const head = card.querySelector('.qr-card-details')!.getBoundingClientRect();
        const footer = card.querySelector('.qr-card-footer')!.getBoundingClientRect();
        const qr = card.querySelector('img')!.getBoundingClientRect();
        return {
          textFits: head.top >= box.top - 1 && footer.bottom <= box.bottom + 1,
          centerX: Math.abs((qr.left + qr.right - box.left - box.right) / 2),
          centerY: Math.abs((qr.top + qr.bottom - box.top - box.bottom) / 2),
        };
      });
    assert.ok(maximumLayout.textFits && maximumLayout.centerX < 1 && maximumLayout.centerY < 1);
    const maximumPdf = await longPrintPage.pdf({
      path: 'docs/validation/final/promptpay-long-name-80mm.pdf',
      preferCSSPageSize: true,
    });
    assert.equal((maximumPdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length, 1);
    await longPrintPage.emulateMedia({ media: 'screen' });
    await longPrintPage.evaluate(() => {
      (window as unknown as { qrPrintCalls: number }).qrPrintCalls = 0;
      window.print = () => {
        (window as unknown as { qrPrintCalls: number }).qrPrintCalls++;
      };
    });
    await operation('SUPER_ADMIN', 'payment.void', {
      id: longPrintPayment.id,
      key: randomUUID(),
      reason: 'Complete maximum-name printing validation',
    });
    await longPrintPage
      .getByRole('button', { name: 'พิมพ์ QR พร้อมเพย์ 80 มม.', exact: true })
      .click();
    await longPrintPage
      .getByRole('alert')
      .getByText('Only an active pending payment QR', { exact: false })
      .waitFor();
    assert.equal(await longPrintPage.locator('.qr-print-overlay .qr-card').count(), 0);
    assert.equal(
      await longPrintPage.evaluate(
        () => (window as unknown as { qrPrintCalls: number }).qrPrintCalls,
      ),
      0,
    );
    await longPrintPage.getByRole('button', { name: 'ปิด', exact: true }).click();
    await operation('SUPER_ADMIN', 'order.void', {
      id: longPrintOrder.id,
      key: randomUUID(),
      reason: 'Complete maximum-name printing validation',
    });
    await operation('SUPER_ADMIN', 'shift.close', { id: longPrintShift.id });
    await operation('SUPER_ADMIN', 'event.close', { eventId: longPrintEvent.id });
    await longPrintPage.context().close();
    pass(
      'Maximum-length PromptPay names fit one page; voided QR is hidden and never sent to the printer',
    );
    await payPage.getByLabel('เลขอ้างอิงธนาคาร').fill(randomUUID());
    await payPage
      .getByLabel('รายละเอียดการตรวจสอบหลักฐาน')
      .fill('Checked recipient, 140.00 THB and transfer evidence');
    await payPage.getByRole('checkbox').check();
    await payPage.getByRole('button', { name: 'ยืนยันรับชำระเงิน', exact: true }).click();
    await payPage.getByText('เซิร์ฟเวอร์ไม่พร้อมใช้งาน', { exact: false }).waitFor();
    await payPage.reload();
    await payPage.getByRole('button', { name: 'ลองยืนยันรายการเดิม', exact: true }).click();
    await payPage.getByRole('heading', { name: 'ใบรับชำระเงิน', exact: true }).waitFor();
    await payPage.getByAltText('Receipt footer QR').waitFor();
    const receiptLogo = payPage.locator('.receipt .receipt-logo');
    assert.equal(await receiptLogo.count(), 1);
    assert.equal(await payPage.locator('.receipt svg.receipt-logo').count(), 0);
    const receiptLogoSize = await receiptLogo.evaluate(async (logo) => {
      await (logo as HTMLImageElement).decode();
      const box = logo.getBoundingClientRect();
      const paper = logo.closest('.receipt')!.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        center: Math.abs((box.left + box.right - paper.left - paper.right) / 2),
      };
    });
    assert.ok(
      receiptLogoSize.center < 1 && receiptLogoSize.width <= 137 && receiptLogoSize.height <= 91,
    );
    const printedCodes = await payPage.locator('.receipt').evaluate(async (receipt) => {
      const images = Array.from(receipt.querySelectorAll('img'));
      return Promise.all(
        images.map(async (image) => {
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = Math.round((image.clientWidth * 203) / 96);
          canvas.height = Math.round((image.clientHeight * 203) / 96);
          const context = canvas.getContext('2d')!;
          context.imageSmoothingEnabled = false;
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          return { alt: image.alt, data: canvas.toDataURL('image/png') };
        }),
      );
    });
    const receiptBarcodeNumber = decodePrintedCode(
      printedCodes.find((code) => code.alt.startsWith('Receipt barcode '))!.data,
    );
    assert.equal(receiptBarcodeNumber, pendingForPrint.number);
    assert.equal(
      decodePrintedCode(
        printedCodes.find((code) => code.alt === 'Receipt footer QR')!.data,
        BarcodeFormat.QR_CODE,
      ),
      'https://ccida.test/feedback',
    );
    assert.ok(!/REPRINT|Queue Number/i.test(await payPage.locator('.receipt').innerText()));
    assert.equal(new Set(retriedKeys['payment.confirm']).size, 1);
    assert.equal(
      await db.auditLog.count({ where: { eventId: uiEvent.id, action: 'PAYMENT_CONFIRM' } }),
      1,
    );
    pass('Payment confirmation lost response, reload and original-key recovery');
    // Clear the earlier screen override so PDF uses real print media.
    await payPage.emulateMedia({ media: null });
    const originalReceiptPdf = await payPage.pdf({
      path: 'docs/validation/final/receipt-original-80mm.pdf',
      preferCSSPageSize: true,
      printBackground: true,
    });
    const originalReceiptText = originalReceiptPdf.toString('latin1');
    assert.match(originalReceiptText, /\/Font/);
    assert.equal((originalReceiptText.match(/\/Type \/Page\b/g) ?? []).length, 1);
    const originalReceiptMedia = originalReceiptText.match(
      /\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/,
    );
    assert.ok(originalReceiptMedia, 'Original receipt paper dimensions');
    assert.ok(Math.abs(Number(originalReceiptMedia[1]) - (80 * 72) / 25.4) < 1);
    await payPage.emulateMedia({ media: 'print' });
    await payPage
      .locator('.receipt')
      .screenshot({ path: 'docs/validation/final/receipt-sample-layout-80mm.png' });
    await writeFile(
      'docs/validation/final/receipt-layout.json',
      JSON.stringify(
        await payPage.evaluate(() => {
          const receipt = document.querySelector('.print-document.receipt')!;
          const overlay = document.querySelector('.receipt-print-overlay')!;
          return {
            width: receipt.getBoundingClientRect().width,
            height: receipt.getBoundingClientRect().height,
            page: getComputedStyle(overlay).page,
            pageRules: Array.from(document.styleSheets).flatMap((sheet) =>
              Array.from(sheet.cssRules)
                .map((rule) => rule.cssText)
                .filter((rule) => rule.includes('@page')),
            ),
          };
        }),
        null,
        2,
      ),
    );
    await payPage.emulateMedia({ media: 'screen' });
    await payPage.evaluate(() => {
      window.print = () => {
        throw new Error('Printer unavailable');
      };
    });
    await payPage.getByRole('button', { name: 'พิมพ์ใบเสร็จ 80 มม.', exact: true }).click();
    await payPage.getByRole('alert').getByText('Printer unavailable.', { exact: false }).waitFor();
    const secondCopyPrinted = payPage.waitForResponse(
      (response) =>
        response.url().endsWith('/api/operations') &&
        response.request().postDataJSON()?.action === 'receipt.print',
    );
    await payPage.getByRole('button', { name: 'พิมพ์ใบเสร็จ 80 มม.', exact: true }).click();
    assert.equal((await secondCopyPrinted).status(), 200);
    await payPage.getByRole('heading', { name: 'สำเนา / COPY', exact: true }).waitFor();
    const receiptAttempts = await db.receipt.findFirstOrThrow({
      where: { payment: { accountId: uiRegistration.account!.id } },
    });
    // The automatic original print is followed by two explicitly requested copies.
    assert.equal(receiptAttempts.printCount, 3);
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
    await payPage.getByRole('button', { name: 'ปิด', exact: true }).click();
    const beforeBarcodeReprint = await db.receipt.findUniqueOrThrow({
      where: { paymentId: pendingForPrint.id },
    });
    await payPage.locator('.receipt-reprint-panel > summary').click();
    await payPage
      .getByRole('textbox', { name: 'Receipt barcode', exact: true })
      .fill(receiptBarcodeNumber);
    await payPage.getByRole('textbox', { name: 'Receipt barcode', exact: true }).press('Enter');
    await payPage.getByRole('heading', { name: 'สำเนา / COPY', exact: true }).waitFor();
    const afterBarcodeReprint = await db.receipt.findUniqueOrThrow({
      where: { paymentId: pendingForPrint.id },
    });
    assert.equal(afterBarcodeReprint.printCount, beforeBarcodeReprint.printCount + 1);
    assert.deepEqual(afterBarcodeReprint.snapshot, beforeBarcodeReprint.snapshot);
    assert.equal(await db.payment.count({ where: { accountId: uiRegistration.account!.id } }), 1);
    pass(
      'Receipt QR and barcode decode at 203 dpi; scanner Enter retrieves an audited COPY without another payment',
    );
    const superPage = await pageFor('SUPER_ADMIN');
    await superPage.waitForURL(base + '/dashboard');
    await selectContext(superPage, uiEvent.id, f.stations[1].id);
    async function saveUi<T>(action: string, submit: () => Promise<unknown>) {
      const waiting = superPage.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/operations' &&
          response.request().postDataJSON()?.action === action,
      );
      await submit();
      const response = await waiting;
      assert.equal(response.status(), 200, `${action}: ${await response.text()}`);
      return response.json() as Promise<T>;
    }
    await superPage.locator('nav').getByRole('button', { name: 'สินค้า', exact: true }).click();
    const categoryPanel = superPage
      .getByRole('heading', { name: 'หมวดหมู่สินค้า', exact: true })
      .locator('..');
    await categoryPanel.getByLabel('ชื่อหมวดหมู่', { exact: true }).fill(`UI-category-${f.tag}`);
    const uiCategory = await saveUi<{ id: string }>('category.save', () =>
      categoryPanel.getByRole('button', { name: 'บันทึก', exact: true }).click(),
    );
    assert.equal(await categoryPanel.getByLabel('ชื่อหมวดหมู่', { exact: true }).inputValue(), '');
    let productPanel = superPage
      .getByRole('heading', { name: 'เพิ่มสินค้า', exact: true })
      .locator('..');
    await productPanel.getByLabel('รหัสสินค้า', { exact: true }).fill(`UI-PRODUCT-${f.tag}`);
    await productPanel.getByLabel('ชื่อสินค้า', { exact: true }).fill(`UI product ${f.tag}`);
    await productPanel.getByLabel('หมวดหมู่', { exact: true }).selectOption(uiCategory.id);
    await productPanel.getByLabel('ราคาขาย (บาท)', { exact: true }).fill('12.50');
    await productPanel.getByLabel('ควบคุมสต็อก', { exact: true }).selectOption('true');
    const productPhoto = await sharp({
      create: { width: 1800, height: 1200, channels: 3, background: '#bf8750' },
    })
      .png()
      .toBuffer();
    const fullSizePhoto = Buffer.concat([
      productPhoto,
      Buffer.alloc(20 * 1024 * 1024 - productPhoto.length),
    ]);
    const photoFile = path.join(tmpdir(), `pos-product-20mb-${f.tag}.png`);
    await writeFile(photoFile, fullSizePhoto);
    await productPanel.locator('input[type="file"]').setInputFiles(photoFile);
    await superPage.waitForFunction(
      () => {
        const image = document.querySelector<HTMLImageElement>('.product-image-preview img');
        return image?.complete && image.naturalWidth > 0;
      },
      undefined,
      { timeout: 90000 },
    );
    const uploadedPhoto = (await productPanel
      .getByAltText('Product image preview')
      .getAttribute('src'))!;
    assert.match(uploadedPhoto, /^\/api\/product-images\/[a-f0-9]{64}$/);
    const uiProduct = await saveUi<{ id: string }>('product.save', () =>
      productPanel.getByRole('button', { name: 'บันทึก', exact: true }).click(),
    );
    const productRow = superPage.locator('tr').filter({ hasText: `UI-PRODUCT-${f.tag}` });
    await productRow.getByRole('button', { name: 'แก้ไข', exact: true }).click();
    productPanel = superPage
      .getByRole('heading', { name: 'แก้ไขสินค้า', exact: true })
      .locator('..');
    assert.equal(
      await productPanel.getByAltText('Product image preview').getAttribute('src'),
      uploadedPhoto,
    );
    await productPanel.getByLabel('ราคาขาย (บาท)', { exact: true }).fill('14.00');
    await productPanel.getByLabel('เปิดขาย', { exact: true }).selectOption('false');
    await saveUi('product.save', () =>
      productPanel.getByRole('button', { name: 'บันทึก', exact: true }).click(),
    );
    assert.equal(
      (await db.product.findUniqueOrThrow({ where: { id: uiProduct.id } })).active,
      false,
    );
    await productRow.getByRole('button', { name: 'แก้ไข', exact: true }).click();
    productPanel = superPage
      .getByRole('heading', { name: 'แก้ไขสินค้า', exact: true })
      .locator('..');
    await productPanel.getByLabel('เปิดขาย', { exact: true }).selectOption('true');
    await saveUi('product.save', () =>
      productPanel.getByRole('button', { name: 'บันทึก', exact: true }).click(),
    );
    assert.equal(
      (await db.product.findUniqueOrThrow({ where: { id: uiProduct.id } })).priceSatang,
      1400,
    );
    pass('Browser category/product creation, form reset, price edit, archive and reactivation');
    await superPage.goto(base + '/pos');
    await selectContext(superPage, uiEvent.id, f.stations[1].id);
    await superPage.getByAltText(`UI product ${f.tag}`, { exact: true }).waitFor();
    assert.equal(await superPage.locator('.sidebar, nav').count(), 0);
    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await superPage.setViewportSize(viewport);
      const layout = await superPage.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        left: document.querySelector('.workspace')!.getBoundingClientRect().left,
        checkoutBottom: document.querySelector('.cart .checkout')!.getBoundingClientRect().bottom,
        photoWidth: document.querySelector('.pos-product-photo')!.getBoundingClientRect().width,
      }));
      assert.equal(layout.overflow, false);
      assert.equal(layout.left, 0);
      assert.ok(layout.photoWidth >= 100);
      if (viewport.width >= 1024) assert.ok(layout.checkoutBottom <= viewport.height + 1);
      await superPage.screenshot({
        path: `docs/validation/final/pos-terminal-${viewport.width}.png`,
        fullPage: true,
      });
    }
    await superPage.setViewportSize({ width: 1440, height: 1000 });
    await superPage.getByRole('button', { name: 'กลับหน้าจัดการ', exact: true }).click();
    await superPage.locator('nav').waitFor();
    pass(
      '20 MB product photo uploads, persists through edits and appears in the full-width POS for Super Admin at desktop/tablet/mobile widths',
    );
    await superPage.locator('nav').getByRole('button', { name: 'สต็อก', exact: true }).click();
    await superPage.getByLabel('สินค้า', { exact: true }).selectOption(uiProduct.id);
    await superPage.getByLabel('ยอดเปิด', { exact: true }).fill('50');
    await superPage.getByLabel('เหตุผล', { exact: true }).fill('Opening browser test stock');
    await saveUi('stock.open', () =>
      superPage.getByRole('button', { name: 'บันทึก', exact: true }).click(),
    );
    await superPage.getByRole('button', { name: 'ปรับปรุงสต็อก', exact: true }).click();
    await superPage.getByLabel('สินค้า', { exact: true }).selectOption(uiProduct.id);
    await superPage.getByLabel('จำนวนปรับ (+ เพิ่ม / − ลด)', { exact: true }).fill('-2');
    await superPage.getByLabel('เหตุผล', { exact: true }).fill('Damaged stock adjustment test');
    await saveUi('stock.adjust', () =>
      superPage.getByRole('button', { name: 'บันทึก', exact: true }).click(),
    );
    assert.equal(
      (
        await db.inventory.findUniqueOrThrow({
          where: { eventId_productId: { eventId: uiEvent.id, productId: uiProduct.id } },
        })
      ).remainingStock,
      48,
    );
    pass('Browser opening stock and negative adjustment with preserved movements');
    await regPage.reload();
    await regPage
      .locator('tr')
      .filter({ hasText: uiRegistration.number })
      .getByRole('button', { name: 'แก้ไข', exact: true })
      .click();
    assert.equal(await regPage.getByLabel('สถานะ', { exact: true }).count(), 0);
    await regPage
      .getByLabel('ชื่อผู้ร่วมงาน', { exact: true })
      .fill('UI corrected settled customer');
    await regPage
      .getByLabel('เหตุผลการแก้ไข', { exact: true })
      .fill('Correct settled customer spelling');
    const settledEdit = regPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/operations' &&
        response.request().postDataJSON()?.action === 'registration.update',
    );
    await regPage.getByRole('button', { name: 'บันทึก', exact: true }).click();
    assert.equal((await settledEdit).status(), 200);
    assert.equal(
      (await db.customerAccount.findUniqueOrThrow({ where: { id: uiRegistration.account!.id } }))
        .status,
      'SETTLED',
    );
    await regPage
      .locator('tr')
      .filter({ hasText: uiRegistration.number })
      .getByRole('button', { name: 'แก้ไข', exact: true })
      .click();
    await regPage.reload();
    await regPage.locator('.workspace').waitFor();
    assert.equal(await regPage.getByLabel('ชื่อผู้ร่วมงาน', { exact: true }).inputValue(), '');
    pass('Browser settled customer edit and reload discard old editor state');
    for (const [view, action, fields] of [
      [
        'ผู้ใช้งาน',
        'user.save',
        {
          ชื่อผู้ใช้งาน: `ui-user-${f.tag}`,
          ชื่อที่แสดง: 'UI managed user',
          'รหัสผ่านใหม่ (อย่างน้อย 14 ตัวอักษร)': 'test-password-12345',
        },
      ],
    ] as const) {
      await superPage.locator('nav').getByRole('button', { name: view, exact: true }).click();
      for (const [label, value] of Object.entries(fields))
        await superPage.getByLabel(label, { exact: true }).fill(value);
      if (action === 'user.save') {
        await superPage.getByLabel('บทบาท', { exact: true }).selectOption('CASHIER');
        await superPage
          .getByLabel('กิจกรรมที่ผูกกับผู้ใช้งาน', { exact: true })
          .selectOption(uiEvent.id);
      }
      const created = await saveUi<{ id: string }>(action, () =>
        superPage.getByRole('button', { name: 'บันทึก', exact: true }).click(),
      );
      if (action === 'user.save') {
        assert.equal(
          (await db.user.findUniqueOrThrow({ where: { id: created.id } })).assignedEventId,
          uiEvent.id,
        );
        // Capture only the new synthetic account after the filtered query finishes.
        await superPage.waitForFunction((username) => {
          const rows = document.querySelectorAll('table tbody tr');
          return rows.length === 1 && rows[0].textContent?.includes(username);
        }, `ui-user-${f.tag}`);
        await superPage.screenshot({
          path: 'docs/validation/final/user-event-assignment.png',
          fullPage: true,
        });
      }
      const row = superPage
        .locator('tr')
        .filter({ hasText: action === 'user.save' ? `ui-user-${f.tag}` : `UI-ST-${f.tag}` });
      await row.getByRole('button', { name: 'แก้ไข', exact: true }).click();
      await superPage.getByLabel('เปิดใช้งาน', { exact: true }).selectOption('false');
      await saveUi(action, () =>
        superPage.getByRole('button', { name: 'บันทึก', exact: true }).click(),
      );
      const active =
        action === 'user.save'
          ? (await db.user.findUniqueOrThrow({ where: { id: created.id } })).active
          : (await db.station.findUniqueOrThrow({ where: { id: created.id } })).active;
      assert.equal(active, false);
      await row.getByRole('button', { name: 'แก้ไข', exact: true }).click();
      await superPage.getByLabel('เปิดใช้งาน', { exact: true }).selectOption('true');
      await saveUi(action, () =>
        superPage.getByRole('button', { name: 'บันทึก', exact: true }).click(),
      );
    }
    pass('Browser user creation, disable and reactivation');
    await superPage.locator('nav').getByRole('button', { name: 'ภาพรวม', exact: true }).click();
    await superPage.getByText('RECONCILED', { exact: true }).waitFor();
    for (const removed of ['จุดบริการ']) {
      assert.equal(
        await superPage.locator('nav').getByRole('button', { name: removed, exact: true }).count(),
        0,
      );
      assert.equal(
        await superPage.getByRole('combobox', { name: removed, exact: true }).count(),
        0,
      );
    }
    const automatic = await operation<{
      event: { id: string };
      station: { id: string; type: string };
    }>('SUPER_ADMIN', 'context.resolve', {});
    assert.equal(automatic.event.id, uiEvent.id);
    assert.equal(automatic.station.type, 'ADMIN');
    assert.equal(
      await superPage.locator('nav').getByRole('button', { name: 'กิจกรรม', exact: true }).count(),
      1,
    );
    assert.equal(
      await superPage.getByRole('combobox', { name: 'กิจกรรม', exact: true }).count(),
      1,
    );
    pass('Event management and event selection restored; station assignments remain automatic');
    for (const type of [
      'summary',
      'products',
      'categories',
      'stations',
      'cashiers',
      'payments',
      'outstanding',
      'registrations',
      'voids',
      'shifts',
      'stock',
    ])
      assert.ok(
        (
          await (
            await request(`/api/export?eventId=${uiEvent.id}&type=${type}`, 'SUPER_ADMIN')
          ).text()
        ).length > 10,
      );
    pass('All eleven report export types return real CSV');
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
    await payPage.emulateMedia({ media: 'print' });
    const receiptLayout = await payPage.locator('.print-document.receipt').evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const logo = element.querySelector('img.receipt-logo')!.getBoundingClientRect();
      return {
        width: bounds.width,
        horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
        logoWidth: logo.width,
        logoHeight: logo.height,
        logoCenter: Math.abs((logo.left + logo.right - bounds.left - bounds.right) / 2),
      };
    });
    assert.ok(Math.abs(receiptLayout.width - (72 * 96) / 25.4) < 1);
    assert.equal(receiptLayout.horizontalOverflow, false);
    assert.ok(
      receiptLayout.logoWidth <= 137 &&
        receiptLayout.logoHeight <= 91 &&
        receiptLayout.logoCenter < 1,
    );
    const copyReceiptPdf = await payPage.pdf({
      path: 'docs/validation/final/receipt-80mm.pdf',
      preferCSSPageSize: true,
      printBackground: true,
    });
    const copyReceiptText = copyReceiptPdf.toString('latin1');
    assert.match(copyReceiptText, /\/Font/);
    assert.equal((copyReceiptText.match(/\/Type \/Page\b/g) ?? []).length, 1);
    const copyReceiptMedia = copyReceiptText.match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);
    assert.ok(copyReceiptMedia, 'COPY receipt paper dimensions');
    assert.ok(Math.abs(Number(copyReceiptMedia[1]) - (80 * 72) / 25.4) < 1);
    await payPage.emulateMedia({ media: 'screen' });
    await payPage.getByRole('button', { name: 'ปิด', exact: true }).click();
    await payPage.getByRole('button', { name: 'รับชำระผู้ร่วมงานถัดไป', exact: true }).click();
    assert.equal(await payPage.getByRole('textbox', { name: 'Customer QR' }).inputValue(), '');
    await payPage.getByRole('heading', { name: 'พร้อมรับชำระเงิน', exact: true }).waitFor();
    // The UI restores focus in the next animation frame after clearing the customer.
    await payPage.waitForFunction(
      () => document.activeElement === document.querySelector('#payment-customer-qr'),
      null,
      { timeout: 2000 },
    );
    assert.equal(await db.payment.count({ where: { accountId: uiRegistration.account!.id } }), 1);
    pass(
      'Next customer clears the settled workspace, restores scanner focus and retains the original payment',
    );
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
    await superPage.locator('nav').getByRole('button', { name: 'กิจกรรม', exact: true }).click();
    await superPage.getByRole('heading', { name: 'ลงทะเบียนกิจกรรม', exact: true }).waitFor();
    const restoredCode = `RESTORED-${f.tag}`;
    await superPage.getByLabel('รหัสกิจกรรม', { exact: true }).fill(restoredCode);
    await superPage
      .getByLabel('ชื่อกิจกรรม', { exact: true })
      .fill('Restored event analytics acceptance');
    await superPage.getByLabel('สถานะกิจกรรม', { exact: true }).selectOption('OPEN');
    const restoredEvent = await saveUi<{ id: string }>('event.save', () =>
      superPage.getByRole('button', { name: 'บันทึก', exact: true }).click(),
    );
    await superPage.getByLabel('ค้นหากิจกรรม', { exact: true }).fill(restoredCode);
    let restoredRow = superPage.locator('tr').filter({ hasText: restoredCode });
    await restoredRow.getByRole('button', { name: 'ลงทะเบียนผู้ร่วมงาน', exact: true }).click();
    await superPage.waitForURL(base + '/register');
    await superPage
      .getByLabel('ชื่อผู้ร่วมงาน', { exact: true })
      .fill('Customer in restored event');
    const restoredCustomer = await saveUi<PrintDto>('registration.create', () =>
      superPage.getByRole('button', { name: 'บันทึก', exact: true }).click(),
    );
    await superPage.getByAltText('Customer QR').waitFor();
    await superPage.getByRole('button', { name: 'ปิด', exact: true }).click();
    const restoredShift = await saveUi<{ id: string; stationId: string }>('shift.open', () =>
      superPage.getByRole('button', { name: 'เปิดกะ', exact: true }).click(),
    );
    await superPage.waitForFunction(
      () =>
        document.querySelector<HTMLSelectElement>('select[aria-label="กิจกรรม"]')?.disabled ===
        true,
    );
    assert.equal(
      await superPage.getByRole('combobox', { name: 'กิจกรรม', exact: true }).isDisabled(),
      true,
    );
    await operation('SUPER_ADMIN', 'order.create', {
      eventId: restoredEvent.id,
      stationId: restoredShift.stationId,
      token: restoredCustomer.token,
      key: randomUUID(),
      items: [{ productId: tea.id, quantity: 1 }],
    });
    const restoredPayment = await operation<{ id: string }>('SUPER_ADMIN', 'payment.generate', {
      eventId: restoredEvent.id,
      stationId: restoredShift.stationId,
      token: restoredCustomer.token,
      key: randomUUID(),
    });
    await operation('SUPER_ADMIN', 'payment.confirm', {
      paymentId: restoredPayment.id,
      stationId: restoredShift.stationId,
      key: randomUUID(),
      reference: randomUUID(),
      evidence: 'Isolated restored event evidence',
      evidenceVerified: true,
    });
    await operation('SUPER_ADMIN', 'shift.close', { id: restoredShift.id });
    await superPage.locator('nav').getByRole('button', { name: 'กิจกรรม', exact: true }).click();
    await superPage.getByLabel('ค้นหากิจกรรม', { exact: true }).fill(restoredCode);
    restoredRow = superPage.locator('tr').filter({ hasText: restoredCode });
    await restoredRow.getByRole('button', { name: 'ปิดกิจกรรม', exact: true }).click();
    await restoredRow
      .getByLabel('เหตุผล', { exact: true })
      .fill('Completed isolated event acceptance');
    await saveUi('event.close', () =>
      restoredRow.getByRole('button', { name: 'ยืนยัน', exact: true }).click(),
    );
    await restoredRow.getByText('CLOSED', { exact: true }).waitFor();
    assert.equal(await restoredRow.getByRole('button', { name: 'แก้ไข', exact: true }).count(), 0);
    await restoredRow.getByRole('button', { name: 'ดูสถิติยอดขาย', exact: true }).click();
    await superPage.waitForURL(base + '/dashboard');
    await superPage.getByText('RECONCILED', { exact: true }).waitFor();
    assert.equal(
      await superPage.getByRole('combobox', { name: 'กิจกรรม', exact: true }).inputValue(),
      restoredEvent.id,
    );
    await request(`/api/dashboard?eventId=${restoredEvent.id}`, 'ADMIN', undefined, 403);
    const assignedAdmin = await db.user.findUniqueOrThrow({ where: { id: f.actors.ADMIN.id } });
    await operation('SUPER_ADMIN', 'user.save', {
      id: assignedAdmin.id,
      username: assignedAdmin.username,
      displayName: assignedAdmin.displayName,
      roleName: assignedAdmin.roleName,
      active: true,
      assignedEventId: restoredEvent.id,
    });
    const restoredSummary = (await (
      await request(`/api/dashboard?eventId=${restoredEvent.id}`, 'ADMIN')
    ).json()) as { registered: number; netSalesSatang: number; confirmedPaymentSatang: number };
    assert.equal(restoredSummary.registered, 1);
    assert.equal(restoredSummary.netSalesSatang, 4000);
    assert.equal(restoredSummary.confirmedPaymentSatang, 4000);
    assert.equal(
      (
        (await (
          await request(`/api/reports?eventId=${uiEvent.id}`, 'SUPER_ADMIN')
        ).json()) as Summary
      ).netSalesSatang,
      14000,
    );
    await superPage.reload();
    await superPage.getByText('RECONCILED', { exact: true }).waitFor();
    assert.equal(
      await superPage.getByRole('combobox', { name: 'กิจกรรม', exact: true }).inputValue(),
      restoredEvent.id,
    );
    await superPage.screenshot({
      path: 'docs/validation/final/event-analytics-closed.png',
      fullPage: true,
    });
    await regPage.locator('nav').getByRole('button', { name: 'ภาพรวม', exact: true }).click();
    await selectContext(regPage, restoredEvent.id, f.stations[0].id);
    assert.equal(await regPage.getByRole('combobox', { name: 'กิจกรรม', exact: true }).count(), 0);
    await regPage.getByText('RECONCILED', { exact: true }).waitFor();
    assert.equal(
      await regPage.locator('nav').getByRole('button', { name: 'กิจกรรม', exact: true }).count(),
      0,
    );
    pass(
      'Browser event creation, registration, isolated sales, safe closing and historical analytics survive reload',
    );
    const paymentUser = await db.user.findUniqueOrThrow({
      where: { id: f.actors.PAYMENT_CASHIER.id },
    });
    await operation('SUPER_ADMIN', 'user.save', {
      id: paymentUser.id,
      username: paymentUser.username,
      displayName: paymentUser.displayName,
      roleName: paymentUser.roleName,
      active: true,
      assignedEventId: restoredEvent.id,
    });
    const historicalReceiptPage = await pageFor('PAYMENT_CASHIER');
    await historicalReceiptPage.reload();
    await historicalReceiptPage.getByText('ไม่มีกิจกรรมเปิดรับชำระ', { exact: false }).waitFor();
    const historicalPayment = await db.payment.findUniqueOrThrow({
      where: { id: restoredPayment.id },
    });
    await historicalReceiptPage
      .getByRole('textbox', { name: 'Customer QR', exact: true })
      .fill(historicalPayment.number);
    await historicalReceiptPage
      .getByRole('textbox', { name: 'Customer QR', exact: true })
      .press('Enter');
    await historicalReceiptPage
      .getByRole('heading', { name: 'สำเนา / COPY', exact: true })
      .waitFor();
    assert.ok(
      (await historicalReceiptPage.locator('.receipt').innerText()).includes(
        historicalPayment.number,
      ),
    );
    assert.equal(await db.payment.count({ where: { accountId: historicalPayment.accountId } }), 1);
    pass('Payment page supports main-scanner receipt reprints with only closed events available');
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
    const clearFixture = await salesFixture();
    await orderAction(clearFixture.actors.CASHIER, 'order.create', clearFixture.orderInput(2));
    const clearEvent = await db.event.findUniqueOrThrow({ where: { id: clearFixture.event.id } });
    await operation('CASHIER', 'event.sales.preview', { eventId: clearEvent.id }, 403);
    await operation('ADMIN', 'event.sales.clear', {}, 403);
    await superPage.goto(base + '/settings');
    await superPage.getByLabel('Event to clear', { exact: true }).selectOption(clearEvent.id);
    await superPage.getByRole('button', { name: 'Preview sales to clear', exact: true }).click();
    const clearButton = superPage.getByRole('button', {
      name: 'Back up and clear event sales',
      exact: true,
    });
    await clearButton.waitFor();
    await superPage.screenshot({
      path: 'docs/validation/final/event-sales-clear-preview.png',
      fullPage: true,
    });
    assert.equal(await clearButton.isDisabled(), true);
    await superPage
      .getByLabel(`Type event code ${clearEvent.code}`, { exact: true })
      .fill(clearEvent.code);
    await superPage
      .getByLabel('Reason for clearing', { exact: true })
      .fill('Browser acceptance reset');
    assert.equal(await clearButton.isDisabled(), true);
    await superPage
      .getByRole('checkbox', {
        name: 'I understand this resets totals and balances and does not refund bank payments.',
        exact: true,
      })
      .check();
    const clearRequest = superPage.waitForRequest(
      (r) =>
        r.url().endsWith('/api/operations') && r.postDataJSON()?.action === 'event.sales.clear',
    );
    await saveUi('event.sales.clear', () => clearButton.click());
    const clearInput = (await clearRequest).postDataJSON().input;
    await superPage
      .getByText('Event sales cleared. Customers and QR cards kept.', { exact: false })
      .waitFor();
    const clearedSummary = (await (
      await request(`/api/reports?eventId=${clearEvent.id}`, 'SUPER_ADMIN')
    ).json()) as Summary;
    assert.equal(clearedSummary.netSalesSatang, 0);
    assert.equal(clearedSummary.grossSalesSatang, 0);
    assert.equal(clearedSummary.outstandingSatang, 0);
    assert.equal(clearedSummary.registered, 1);
    assert.equal(
      await db.qrCredential.count({
        where: {
          accountId: clearFixture.registration.account.id,
          token: clearFixture.registration.token,
          revokedAt: null,
        },
      }),
      1,
    );
    await orderAction(clearFixture.actors.CASHIER, 'order.create', clearFixture.orderInput());
    await operation('SUPER_ADMIN', 'event.sales.clear', clearInput);
    const newSummary = (await (
      await request(`/api/reports?eventId=${clearEvent.id}`, 'SUPER_ADMIN')
    ).json()) as Summary;
    assert.equal(newSummary.netSalesSatang, 4550);
    await superPage.reload();
    await superPage.getByLabel('Event to clear', { exact: true }).selectOption(clearEvent.id);
    await superPage.getByRole('button', { name: 'Preview sales to clear', exact: true }).click();
    await superPage.getByText('Previous resets', { exact: true }).waitFor();
    pass(
      'Settings clears one event after typed confirmation and backup, keeps QR cards, and retries cannot erase new sales',
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
    if (receiptSettingsBefore)
      await operation('SUPER_ADMIN', 'settings.save', receiptSettingsBefore);
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
      {
        checks: results,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
