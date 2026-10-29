import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { salesFixture } from './sales-helpers';
import { orderAction } from '../src/lib/orders';
import { paymentAction } from '../src/lib/payments';
import { registrationAction } from '../src/lib/registration';
import { readData } from '../src/lib/data';
import { manage } from '../src/lib/management';
import { summarize } from '../src/lib/reports';
import { transaction } from '../src/lib/db';
import { operationsAction } from '../src/lib/operations';
import type { OrderDto, PaymentDto, ReceiptDto } from '../src/components/types';

afterAll(() => db.$disconnect());

async function instantFixture() {
  const f = await salesFixture();
  await registrationAction(f.actors.SUPER_ADMIN, 'event.save', {
    id: f.event.id,
    code: `SALE-${f.tag}`,
    name: 'Instant event',
    status: 'OPEN',
    paymentMode: 'INSTANT',
  });
  const instantInput = (method: 'CASH' | 'PROMPTPAY' = 'CASH') => ({
    ...f.orderInput(),
    token: undefined,
    paymentMethod: method,
    expectedTotalSatang: 4550,
  });
  return { ...f, instantInput };
}

describe('instant POS sales and category access', () => {
  it('stores explicit category assignments, filters catalog reads and rejects forged or stale products', async () => {
    const f = await salesFixture();
    const hidden = await db.category.create({ data: { name: `Hidden-${f.tag}` } });
    const hiddenProduct = await db.product.create({
      data: {
        code: `H-${f.tag}`,
        name: 'Hidden product',
        categoryId: hidden.id,
        priceSatang: 100,
      },
    });
    expect(
      ((await readData(f.actors.CASHIER, 'categories')) as { id: string }[]).map((row) => row.id),
    ).toEqual([f.category.id]);
    expect(
      ((await readData(f.actors.CASHIER, 'products', f.event.id)) as { id: string }[]).map(
        (row) => row.id,
      ),
    ).toEqual([f.product.id]);
    await expect(
      orderAction(f.actors.CASHIER, 'order.create', {
        ...f.orderInput(),
        items: [{ productId: hiddenProduct.id, quantity: 1 }],
      }),
    ).rejects.toThrow('not assigned');
    const user = await db.user.findUniqueOrThrow({ where: { id: f.actors.CASHIER.id } });
    const input = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      roleName: user.roleName,
      assignedEventId: f.event.id,
      posCategoryIds: [],
    };
    await expect(manage(f.actors.CASHIER, 'user.save', input)).rejects.toThrow('not authorized');
    await expect(
      manage(f.actors.SUPER_ADMIN, 'user.save', { ...input, posCategoryIds: [randomUUID()] }),
    ).rejects.toThrow('do not exist');
    await manage(f.actors.SUPER_ADMIN, 'user.save', input);
    expect(await readData(f.actors.CASHIER, 'categories')).toEqual([]);
    expect(await readData(f.actors.CASHIER, 'products', f.event.id)).toEqual([]);
    await expect(orderAction(f.actors.CASHIER, 'order.create', f.orderInput())).rejects.toThrow(
      'not assigned',
    );
    await manage(f.actors.SUPER_ADMIN, 'user.save', { ...input, posCategoryIds: [hidden.id] });
    expect(
      ((await readData(f.actors.CASHIER, 'products', f.event.id)) as { id: string }[]).map(
        (row) => row.id,
      ),
    ).toEqual([hiddenProduct.id]);
    expect(await db.order.count({ where: { eventId: f.event.id } })).toBe(0);
  });

  it('creates a walk-in cash sale once, confirms once, issues an own receipt and reconciles stock and totals', async () => {
    const f = await instantFixture();
    await db.product.update({ where: { id: f.product.id }, data: { trackStock: true } });
    await operationsAction(f.actors.SUPER_ADMIN, 'stock.open', {
      eventId: f.event.id,
      productId: f.product.id,
      quantity: 5,
      reason: 'Opening count',
    });
    const input = f.instantInput();
    const [first, replay] = (await Promise.all([
      orderAction(f.actors.CASHIER, 'order.create', input),
      orderAction(f.actors.CASHIER, 'order.create', input),
    ])) as unknown as OrderDto[];
    expect(first.id).toBe(replay.id);
    expect(first.status).toBe('RECORDED');
    const payment = first.payment!;
    expect(payment.method).toBe('CASH');
    expect(payment.status).toBe('AWAITING_CONFIRMATION');
    const confirm = {
      paymentId: payment.id,
      stationId: f.stations[1].id,
      key: randomUUID(),
      reference: 'Cash sale',
      evidence: 'Cash counted',
      evidenceVerified: true,
      cashReceivedSatang: 5000,
    };
    await expect(
      paymentAction(f.secondCashier, 'payment.pos.confirm', {
        ...confirm,
        stationId: f.stations[2].id,
      }),
    ).rejects.toThrow('does not belong');
    await expect(
      paymentAction(f.actors.CASHIER, 'payment.pos.confirm', {
        ...confirm,
        cashReceivedSatang: 4500,
      }),
    ).rejects.toThrow('cover');
    await expect(paymentAction(f.actors.CASHIER, 'payment.confirm', confirm)).rejects.toThrow(
      'not authorized',
    );
    const recovered = (await paymentAction(f.actors.CASHIER, 'payment.pos.resume', {
      paymentId: payment.id,
      eventId: f.event.id,
      stationId: f.stations[1].id,
    })) as unknown as { payment: PaymentDto };
    expect(recovered.payment.id).toBe(payment.id);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = (await paymentAction(
        f.actors.CASHIER,
        'payment.pos.confirm',
        confirm,
      )) as unknown as {
        payment: PaymentDto;
      };
      expect(result.payment.status).toBe('CONFIRMED');
    }
    const receipt = (await paymentAction(f.actors.CASHIER, 'receipt.print', {
      paymentId: payment.id,
    })) as ReceiptDto;
    expect(receipt.snapshot).toMatchObject({
      method: 'CASH',
      amountSatang: 4550,
      cashReceivedSatang: 5000,
      changeSatang: 450,
    });
    await expect(
      paymentAction(f.secondCashier, 'receipt.print', { paymentId: payment.id }),
    ).rejects.toThrow('own instant');
    expect(await db.order.count({ where: { eventId: f.event.id } })).toBe(1);
    expect(await db.paymentAllocation.count({ where: { paymentId: payment.id } })).toBe(1);
    expect(
      (
        await db.inventory.findFirstOrThrow({
          where: { eventId: f.event.id, productId: f.product.id },
        })
      ).remainingStock,
    ).toBe(4);
    expect(await transaction((tx) => summarize(tx, f.event.id))).toMatchObject({
      netSalesSatang: 4550,
      confirmedPaymentSatang: 4550,
      outstandingSatang: 0,
      reconciled: true,
    });
    await expect(
      registrationAction(f.actors.SUPER_ADMIN, 'event.save', {
        id: f.event.id,
        code: `SALE-${f.tag}`,
        name: 'Changed',
        status: 'OPEN',
        paymentMode: 'WALLET',
      }),
    ).rejects.toThrow('after sales');
  });

  it('snapshots PromptPay, requires verified bank evidence and rolls back unavailable payment methods', async () => {
    const f = await instantFixture();
    await paymentAction(f.actors.SUPER_ADMIN, 'promptpay.save', {
      type: 'PHONE',
      identifier: '0812345678',
      displayName: 'Instant recipient',
      enabled: false,
    });
    await expect(
      orderAction(f.actors.CASHIER, 'order.create', f.instantInput('PROMPTPAY')),
    ).rejects.toThrow('not been configured');
    expect(await db.order.count({ where: { eventId: f.event.id } })).toBe(0);
    await paymentAction(f.actors.SUPER_ADMIN, 'promptpay.save', {
      type: 'PHONE',
      identifier: '0812345678',
      displayName: 'Instant recipient',
      enabled: true,
    });
    const order = (await orderAction(
      f.actors.CASHIER,
      'order.create',
      f.instantInput('PROMPTPAY'),
    )) as unknown as OrderDto;
    expect(order.payment?.qrImage).toMatch(/^data:image\/png/);
    const resumed = (await paymentAction(f.actors.CASHIER, 'payment.pos.resume', {
      eventId: f.event.id,
      stationId: f.stations[1].id,
      paymentId: order.payment!.id,
    })) as unknown as { payment: PaymentDto };
    expect(resumed.payment.displayName).toBe('Instant recipient');
    expect(resumed.payment.qrImage).toBe(order.payment!.qrImage);
    const confirmation = {
      paymentId: order.payment!.id,
      stationId: f.stations[1].id,
      key: randomUUID(),
      reference: randomUUID(),
      evidence: 'Bank transfer verified',
      evidenceVerified: true,
    };
    await expect(
      paymentAction(f.actors.CASHIER, 'payment.pos.confirm', {
        ...confirmation,
        evidenceVerified: false,
      }),
    ).rejects.toThrow();
    await paymentAction(f.actors.CASHIER, 'payment.pos.confirm', confirmation);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID');
    const wallet = await salesFixture();
    await expect(
      orderAction(wallet.actors.CASHIER, 'order.create', {
        ...wallet.orderInput(),
        token: undefined,
        paymentMethod: 'CASH',
      }),
    ).rejects.toThrow('customer QR');
    await expect(
      paymentAction(wallet.actors.CASHIER, 'payment.pos.resume', {
        eventId: f.event.id,
        stationId: wallet.stations[1].id,
        paymentId: order.payment!.id,
      }),
    ).rejects.toThrow('not assigned');
  });
});
