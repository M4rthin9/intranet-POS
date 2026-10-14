import { randomUUID } from 'node:crypto';
import { fixture } from './helpers';
import { registrationAction } from '../src/lib/registration';
import { catalogAction } from '../src/lib/catalog';
import { orderAction } from '../src/lib/orders';
import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';
export async function salesFixture() {
  const f = await fixture();
  const event = (await registrationAction(f.actors.SUPER_ADMIN, 'event.save', {
    code: `SALE-${f.tag}`,
    name: 'Integration event',
    status: 'OPEN',
  })) as { id: string };
  const registration = (await registrationAction(f.actors.ADMIN, 'registration.create', {
    eventId: event.id,
    stationId: f.stations[0].id,
    customerName: 'Customer',
  })) as unknown as { id: string; token: string; account: { id: string } };
  const category = (await catalogAction(f.actors.SUPER_ADMIN, 'category.save', {
    name: `Drinks-${f.tag}`,
  })) as { id: string };
  const product = (await catalogAction(f.actors.SUPER_ADMIN, 'product.save', {
    code: f.tag,
    name: 'Thai Tea',
    categoryId: category.id,
    priceBaht: '45.50',
  })) as unknown as { id: string; priceSatang: number };
  const extra = await db.user.create({
    data: {
      username: `${f.tag}-second`,
      displayName: 'Second cashier',
      roleName: 'CASHIER',
      passwordHash: hashPassword('second-test-password'),
    },
  });
  const secondCashier = { id: extra.id, roleName: 'CASHIER' as const };
  await orderAction(f.actors.CASHIER, 'shift.open', {
    eventId: event.id,
    stationId: f.stations[1].id,
  });
  await orderAction(secondCashier, 'shift.open', {
    eventId: event.id,
    stationId: f.stations[2].id,
  });
  await orderAction(f.actors.PAYMENT_CASHIER, 'shift.open', {
    eventId: event.id,
    stationId: f.stations[3].id,
  });
  const orderInput = (quantity = 1) => ({
    eventId: event.id,
    stationId: f.stations[1].id,
    token: registration.token,
    key: randomUUID(),
    items: [{ productId: product.id, quantity }],
  });
  return { ...f, event, registration, category, product, secondCashier, orderInput };
}
