import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';
import { audit, type Actor } from '../src/lib/audit';
import { initializeRoles } from '../src/lib/initialize-roles';
import { registrationAction } from '../src/lib/registration';
import { orderAction } from '../src/lib/orders';
import { paymentAction } from '../src/lib/payments';
import { controlAction } from '../src/lib/controls';
import { operationsAction } from '../src/lib/operations';
import { validateIdentifier } from '../src/lib/promptpay';
import { assertTestSeedTarget } from './test-database';
export { assertTestSeedTarget } from './test-database';

export const DEFAULT_SEED_PASSWORD = 'CCIDA-Test-2026!';

function seedId(namespace: string, label: string) {
  const bytes = createHash('sha256').update(`ccida-test-seed:v1:${namespace}:${label}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertOwned(row: { id: string } | null, id: string, label: string) {
  if (row && row.id !== id)
    throw new Error(`Seed name collision for ${label}. Existing records will not be overwritten.`);
}

export async function seedTestData(
  options: {
    password?: string;
    namespace?: string;
    promptPayPhone?: string;
  } = {},
) {
  const target = assertTestSeedTarget(process.env.DATABASE_URL);
  const password = options.password ?? DEFAULT_SEED_PASSWORD;
  const namespace = options.namespace ?? 'DEMO';
  if (password.length < 14 || password.length > 256)
    throw new Error('SEED_PASSWORD must contain 14–256 characters.');
  if (!/^[A-Z][A-Z0-9-]{0,15}$/.test(namespace)) throw new Error('Invalid test seed namespace.');
  if (options.promptPayPhone) validateIdentifier('PHONE', options.promptPayPhone);
  const manifestKey = `test-seed:${namespace}:v1`;
  const eventId = seedId(namespace, 'event');
  const reason = `Test seed ${namespace}; synthetic training data only`;

  // A connection holds only the advisory lock. Service transactions commit independently,
  // so interrupted runs can resume through deterministic identities and submission keys.
  return db.$transaction(
    async (lock) => {
      await lock.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${manifestKey}, 0))`;
      const usersSpec = [
        ['superadmin', 'SUPER_ADMIN', 'Demo system administrator'],
        ['registration', 'ADMIN', 'Demo registration desk'],
        ['cashier01', 'CASHIER', 'Demo POS cashier 1'],
        ['cashier02', 'CASHIER', 'Demo POS cashier 2'],
        ['payment', 'PAYMENT_CASHIER', 'Demo payment cashier'],
        ['register', 'REGISTRATION_CASHIER', 'Demo registration cashier'],
      ] as const;
      const stationsSpec = [
        ['REG-01', 'REGISTRATION'],
        ['POS-01', 'POS'],
        ['POS-02', 'POS'],
        ['PAY-01', 'PAYMENT'],
        ['ADMIN-01', 'ADMIN'],
        ['REG-02', 'REGISTRATION'],
      ] as const;
      const productsSpec = [
        ['TEA', 'ชาไทย (ทดสอบ)', 'DRINK', 4550, false, 100],
        ['COFFEE', 'กาแฟ (ทดสอบ)', 'DRINK', 4000, false, 100],
        ['WATER', 'น้ำดื่ม (ทดสอบ)', 'DRINK', 1500, true, 100],
        ['CAKE', 'เค้ก (ทดสอบ)', 'FOOD', 6000, true, 30],
        ['SNACK', 'ขนม (สต็อกต่ำ ทดสอบ)', 'FOOD', 2500, true, 4],
        ['SOLDOUT', 'สินค้าหมด (ทดสอบ)', 'FOOD', 3000, true, 0],
      ] as const;
      const configuration = await db.$transaction(
        async (tx) => {
          await initializeRoles(tx);
          const users = [];
          const newCashierIds: string[] = [];
          const superActor: Actor = {
            id: seedId(namespace, 'user:superadmin'),
            roleName: 'SUPER_ADMIN',
          };
          for (const [suffix, roleName, displayName] of usersSpec) {
            const username = `${namespace.toLowerCase()}.${suffix}`;
            const id = seedId(namespace, `user:${suffix}`);
            let user = await tx.user.findUnique({ where: { username } });
            assertOwned(user, id, username);
            if (!user) {
              user = await tx.user.create({
                data: { id, username, displayName, roleName, passwordHash: hashPassword(password) },
              });
              if (roleName === 'CASHIER') newCashierIds.push(user.id);
              await audit(tx, superActor, 'USER_CREATE', 'User', user.id, {
                after: { username, roleName },
                reason,
              });
            }
            users.push(user);
          }
          const stations = [];
          for (const [suffix, type] of stationsSpec) {
            const code = `${namespace}-${suffix}`;
            const id = seedId(namespace, `station:${suffix}`);
            let value = await tx.station.findUnique({ where: { code } });
            assertOwned(value, id, code);
            if (!value) {
              value = await tx.station.create({ data: { id, code, name: `${code} (test)`, type } });
              await audit(tx, superActor, 'STATION_CREATE', 'Station', id, {
                after: value,
                reason,
              });
            }
            stations.push(value);
          }
          const code = `${namespace}-CCIDA-TEST`;
          let event = await tx.event.findUnique({ where: { code } });
          assertOwned(event, eventId, code);
          if (!event) {
            event = await tx.event.create({
              data: { id: eventId, code, name: `CCIDA งานทดสอบ (${namespace})`, status: 'OPEN' },
            });
            await audit(tx, superActor, 'EVENT_CREATE', 'Event', event.id, {
              eventId,
              after: event,
              reason,
            });
          }
          const categories = [];
          for (const user of users) {
            if (user.roleName !== 'SUPER_ADMIN' && !user.assignedEventId) {
              await tx.user.update({ where: { id: user.id }, data: { assignedEventId: event.id } });
              await audit(tx, superActor, 'USER_UPDATE', 'User', user.id, {
                before: { assignedEventId: null },
                after: { assignedEventId: event.id },
                reason,
              });
            }
          }
          for (const [suffix, name] of [
            ['DRINK', 'เครื่องดื่ม'],
            ['FOOD', 'อาหารและขนม'],
          ] as const) {
            const id = seedId(namespace, `category:${suffix}`);
            const fullName = `${name} (${namespace} test)`;
            let value = await tx.category.findUnique({ where: { name: fullName } });
            assertOwned(value, id, fullName);
            if (!value) {
              value = await tx.category.create({
                data: { id, name: fullName, sortOrder: categories.length },
              });
              await audit(tx, superActor, 'CATEGORY_CREATE', 'Category', id, {
                after: value,
                reason,
              });
            }
            categories.push(value);
          }
          for (const id of newCashierIds)
            await tx.user.update({
              where: { id },
              data: {
                posCategories: { connect: categories.map((category) => ({ id: category.id })) },
              },
            });
          const products = [];
          for (const [suffix, name, category, priceSatang, trackStock] of productsSpec) {
            const id = seedId(namespace, `product:${suffix}`);
            const code = `${namespace}-${suffix}`;
            let value = await tx.product.findUnique({ where: { code } });
            assertOwned(value, id, code);
            if (!value) {
              value = await tx.product.create({
                data: {
                  id,
                  code,
                  name,
                  categoryId: seedId(namespace, `category:${category}`),
                  priceSatang,
                  trackStock,
                  sortOrder: products.length,
                  lowStockThreshold: 5,
                },
              });
              await audit(tx, superActor, 'PRODUCT_CREATE', 'Product', id, {
                after: value,
                reason,
              });
            }
            products.push(value);
          }
          return { users, stations, event, products };
        },
        { timeout: 30000 },
      );
      const { users, stations, event, products } = configuration;
      const describeResult = async (paymentScenario: string, alreadyComplete: boolean) => ({
        target,
        event: { id: event.id, code: event.code, status: event.status },
        users: users.map(({ username, roleName, active }) => ({
          username,
          role: roleName,
          active,
        })),
        stations: stations.map(({ code, type }) => ({ code, type })),
        products: products.length,
        registrations: await db.registration.count({ where: { eventId } }),
        orders: await db.order.count({ where: { eventId } }),
        payments: await db.payment.count({ where: { eventId } }),
        paymentScenario,
        alreadyComplete,
      });
      const manifest = await db.systemSetting.findUnique({ where: { key: manifestKey } });
      if ((manifest?.value as { complete?: boolean } | undefined)?.complete)
        return describeResult(
          (manifest!.value as { paymentScenario: string }).paymentScenario,
          true,
        );
      if (event.status !== 'OPEN')
        throw new Error('Seed event is no longer open. Its state was preserved.');
      if (users.some((user, index) => !user.active || user.roleName !== usersSpec[index][1]))
        throw new Error('A demo user was disabled or changed role. Its state was preserved.');
      const actors = users.map(({ id, roleName }): Actor => ({ id, roleName }));
      const [superActor, registrar, cashier1, cashier2, paymentCashier, registrationCashier] =
        actors;
      for (let index = 0; index < products.length; index++) {
        const product = products[index];
        if (
          product.trackStock &&
          !(await db.inventory.findUnique({
            where: { eventId_productId: { eventId, productId: product.id } },
          }))
        )
          await operationsAction(superActor, 'stock.open', {
            eventId,
            productId: product.id,
            quantity: productsSpec[index][5],
            reason,
          });
      }
      for (const [actor, station] of [
        [registrar, stations[0]],
        [cashier1, stations[1]],
        [cashier2, stations[2]],
        [paymentCashier, stations[3]],
        [registrationCashier, stations[5]],
      ] as const)
        await orderAction(actor, 'shift.open', { eventId, stationId: station.id });
      const registrations: Prisma.RegistrationGetPayload<{
        include: { account: { include: { credentials: true } } };
      }>[] = [];
      for (const [index, scenario] of [
        'new',
        'unpaid',
        'settlement',
        'blocked',
        'reissued',
        'voided',
      ].entries()) {
        const notes = `test-seed:${namespace}:v1:${scenario}`;
        let registration = await db.registration.findFirst({
          where: { eventId, notes },
          include: { account: { include: { credentials: true } } },
        });
        if (!registration) {
          const result = (await registrationAction(registrar, 'registration.create', {
            eventId,
            stationId: stations[0].id,
            customerName: `ลูกค้าทดสอบ ${scenario} (${namespace})`,
            group: 'TEST DATA ONLY',
            tableNumber: String(index + 1),
            guestCount: (index % 3) + 1,
            notes,
          })) as { id: string };
          registration = await db.registration.findUniqueOrThrow({
            where: { id: result.id },
            include: { account: { include: { credentials: true } } },
          });
        }
        registrations.push(registration);
      }
      const token = (index: number) => {
        const value = registrations[index].account?.credentials.find(
          (credential) => !credential.revokedAt,
        )?.token;
        if (!value)
          throw new Error('A demo account has no active credential. Its history was preserved.');
        return value;
      };
      for (const [label, customer, actor, stationIndex, productIndex, quantity] of [
        ['unpaid-pos1', 1, cashier1, 1, 0, 2],
        ['unpaid-pos2', 1, cashier2, 2, 3, 1],
        ['settlement-pos1', 2, cashier1, 1, 1, 2],
        ['settlement-pos2', 2, cashier2, 2, 2, 2],
        ['void-order', 5, cashier1, 1, 3, 1],
      ] as const) {
        await orderAction(actor, 'order.create', {
          eventId,
          stationId: stations[stationIndex].id,
          token: token(customer),
          key: seedId(namespace, label),
          items: [{ productId: products[productIndex].id, quantity }],
        });
      }
      const voidOrder = await db.order.findFirstOrThrow({
        where: { accountId: registrations[5].account!.id },
      });
      await controlAction(superActor, 'order.void', {
        id: voidOrder.id,
        key: seedId(namespace, 'void-confirm'),
        reason,
      });
      if (registrations[3].account!.status === 'ACTIVE')
        await registrationAction(registrar, 'qr.block', {
          registrationId: registrations[3].id,
          reason,
        });
      if (!registrations[4].account!.credentials.some((credential) => credential.reason === reason))
        await registrationAction(registrar, 'qr.reissue', {
          registrationId: registrations[4].id,
          reason,
        });

      let settings = await db.promptPaySetting.findUnique({ where: { id: 'primary' } });
      if (!settings && options.promptPayPhone) {
        await paymentAction(superActor, 'promptpay.save', {
          type: 'PHONE',
          identifier: options.promptPayPhone,
          displayName: 'TEST ONLY — do not transfer money',
          enabled: true,
        });
        settings = await db.promptPaySetting.findUnique({ where: { id: 'primary' } });
      }
      let paymentScenario =
        'SKIPPED: PromptPay is not enabled; settlement customer has unpaid orders.';
      if (settings?.enabled) {
        const payment = (await paymentAction(paymentCashier, 'payment.generate', {
          eventId,
          stationId: stations[3].id,
          token: token(2),
          key: seedId(namespace, 'payment-generate'),
        })) as { id: string };
        await paymentAction(paymentCashier, 'payment.confirm', {
          paymentId: payment.id,
          stationId: stations[3].id,
          key: seedId(namespace, 'payment-confirm'),
          reference: `${namespace}-TEST-NOT-A-BANK-TRANSFER`,
          evidence: reason,
          evidenceVerified: true,
        });
        paymentScenario =
          'SEEDED: synthetic confirmed payment and receipt; no bank transfer occurred.';
      }
      const value: Prisma.InputJsonObject = {
        complete: true,
        eventId,
        paymentScenario,
        version: 1,
      };
      await db.$transaction(async (tx) => {
        await tx.systemSetting.upsert({
          where: { key: manifestKey },
          create: { key: manifestKey, value },
          update: { value },
        });
        await audit(tx, superActor, 'TEST_SEED_COMPLETE', 'Event', eventId, {
          eventId,
          after: value,
          reason,
        });
      });
      return describeResult(paymentScenario, false);
    },
    { timeout: 120000, maxWait: 10000 },
  );
}
