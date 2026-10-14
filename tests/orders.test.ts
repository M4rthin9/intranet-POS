import { describe, it, expect, afterAll } from 'vitest';
import { salesFixture } from './sales-helpers';
import { orderAction } from '../src/lib/orders';
import { catalogAction } from '../src/lib/catalog';
import { db } from '../src/lib/db';
import { registrationAction } from '../src/lib/registration';
import { bahtToSatang } from '../src/lib/money';
afterAll(() => db.$disconnect());
describe('POS orders', () => {
  it('commits ten simultaneous independent-account checkouts without a global numbering bottleneck', async () => {
    const f = await salesFixture();
    const tokens: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = (await registrationAction(f.actors.ADMIN, 'registration.create', {
        eventId: f.event.id,
        stationId: f.stations[0].id,
        customerName: `Burst customer ${i}`,
      })) as unknown as { token: string };
      tokens.push(r.token);
    }
    const orders = (await Promise.all(
      tokens.map((token) =>
        orderAction(f.actors.CASHIER, 'order.create', { ...f.orderInput(), token }),
      ),
    )) as { id: string; number: string }[];
    expect(new Set(orders.map((o) => o.number)).size).toBe(10);
    expect(await db.order.count({ where: { eventId: f.event.id } })).toBe(10);
  });
  it('records exact server totals, immutable snapshots and duplicate protection', async () => {
    const f = await salesFixture();
    const input = f.orderInput(2);
    const result = (await orderAction(f.actors.CASHIER, 'order.create', {
      ...input,
      totalSatang: 1,
    })) as { id: string; totalSatang: number };
    expect(result.totalSatang).toBe(9100);
    const duplicate = (await orderAction(f.actors.CASHIER, 'order.create', input)) as {
      id: string;
    };
    expect(duplicate.id).toBe(result.id);
    await expect(
      orderAction(f.actors.CASHIER, 'order.create', {
        ...input,
        items: [{ productId: f.product.id, quantity: 3 }],
      }),
    ).rejects.toThrow('different data');
    await catalogAction(f.actors.SUPER_ADMIN, 'product.save', {
      id: f.product.id,
      code: f.tag,
      name: 'New name',
      categoryId: f.category.id,
      priceBaht: '90.00',
    });
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: result.id } });
    expect(item.productNameSnapshot).toBe('Thai Tea');
    expect(item.unitPriceSatang).toBe(4550);
    expect(
      (
        (await orderAction(f.actors.CASHIER, 'account.lookup', {
          eventId: f.event.id,
          token: f.registration.token,
        })) as { outstandingSatang: number }
      ).outstandingSatang,
    ).toBe(9100);
  });
  it('allows two stations and prevents simultaneous duplicate checkout', async () => {
    const f = await salesFixture();
    const input = f.orderInput();
    const results = (await Promise.all([
      orderAction(f.actors.CASHIER, 'order.create', input),
      orderAction(f.actors.CASHIER, 'order.create', input),
    ])) as { id: string }[];
    expect(results[0].id).toBe(results[1].id);
    await orderAction(f.secondCashier, 'order.create', {
      ...f.orderInput(3),
      stationId: f.stations[2].id,
    });
    expect(await db.order.count({ where: { accountId: f.registration.account.id } })).toBe(2);
    await expect(orderAction(f.actors.ADMIN, 'order.create', input)).rejects.toThrow(
      'not authorized',
    );
    await expect(orderAction(f.actors.PAYMENT_CASHIER, 'order.create', input)).rejects.toThrow(
      'not authorized',
    );
    await expect(
      orderAction(f.actors.CASHIER, 'order.create', {
        ...f.orderInput(),
        stationId: f.stations[3].id,
      }),
    ).rejects.toThrow('wrong type');
  });
  it('parses decimal THB prices without floating point arithmetic', () => {
    expect(bahtToSatang('0.29')).toBe(29);
    expect(bahtToSatang('45.5')).toBe(4550);
    expect(() => bahtToSatang('1.001')).toThrow();
  });
});
