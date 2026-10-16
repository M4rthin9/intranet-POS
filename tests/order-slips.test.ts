import { afterAll, describe, expect, it } from 'vitest';
import { salesFixture } from './sales-helpers';
import { db } from '../src/lib/db';
import { orderAction } from '../src/lib/orders';
import { paymentAction } from '../src/lib/payments';
import { orderSlipQr } from '../src/lib/order-slip-qr';
import { decodePrintedCode } from './image-decode';
import type { OrderSlipDto } from '../src/components/types';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { registrationAction } from '../src/lib/registration';
import { controlAction } from '../src/lib/controls';

afterAll(() => db.$disconnect());

describe('POS purchase slips', () => {
  it('prints immutable items, carries an order reference and settles the complete account using the printed QR', async () => {
    const f = await salesFixture();
    const input = f.orderInput(2);
    const order = (await orderAction(f.actors.CASHIER, 'order.create', input)) as { id: string };
    await orderAction(f.secondCashier, 'order.create', {
      ...f.orderInput(),
      stationId: f.stations[2].id,
    });
    await db.product.update({
      where: { id: f.product.id },
      data: { name: 'Changed catalog name', priceSatang: 9900 },
    });
    const printInput = { orderId: order.id, eventId: f.event.id };
    const slip = (await orderAction(f.actors.CASHIER, 'order.slip', printInput)) as OrderSlipDto;
    expect(slip.copy).toBe(false);
    expect(slip.totalSatang).toBe(9100);
    expect(slip.items[0].productNameSnapshot).toBe('Thai Tea');
    expect(slip.items[0].unitPriceSatang).toBe(4550);
    expect(slip.items[0].quantity).toBe(2);
    const qr = decodePrintedCode(slip.qrImage);
    expect(qr).toBe(orderSlipQr(order.id, f.registration.token));
    expect(qr.length).toBeLessThanOrEqual(100);
    // Match the physical 38 mm QR on a 203 dpi thermal printer, including quiet zone.
    const thermal = await sharp(Buffer.from(slip.qrImage.split(',')[1], 'base64'))
      .resize(304, 304, { kernel: 'nearest' })
      .png()
      .toBuffer();
    expect(decodePrintedCode(`data:image/png;base64,${thermal.toString('base64')}`)).toBe(qr);
    const account = (await orderAction(f.actors.PAYMENT_CASHIER, 'account.lookup', {
      eventId: f.event.id,
      token: qr,
    })) as { outstandingSatang: number; scannedOrder: { id: string } };
    expect(account.outstandingSatang).toBe(13650);
    expect(account.scannedOrder.id).toBe(order.id);
    const copy = (await orderAction(f.actors.CASHIER, 'order.slip', printInput)) as OrderSlipDto;
    expect(copy.copy).toBe(true);
    expect(decodePrintedCode(copy.qrImage)).toBe(qr);
    const replay = (await orderAction(f.actors.CASHIER, 'order.create', input)) as { id: string };
    expect(replay.id).toBe(order.id);
    expect(await db.order.count({ where: { accountId: f.registration.account.id } })).toBe(2);
    await paymentAction(f.actors.SUPER_ADMIN, 'promptpay.save', {
      type: 'PHONE',
      identifier: '0812345678',
      displayName: 'TEST ONLY',
      enabled: true,
    });
    const payment = (await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
      eventId: f.event.id,
      stationId: f.stations[3].id,
      token: qr,
      key: randomUUID(),
    })) as { id: string; amountSatang: number };
    expect(payment.amountSatang).toBe(13650);
    await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', {
      paymentId: payment.id,
      stationId: f.stations[3].id,
      key: randomUUID(),
      reference: randomUUID(),
      evidence: 'Verified test transfer',
      evidenceVerified: true,
    });
    const settled = (await orderAction(f.actors.PAYMENT_CASHIER, 'account.lookup', {
      eventId: f.event.id,
      token: qr,
    })) as { status: string; outstandingSatang: number };
    expect(settled.status).toBe('SETTLED');
    expect(settled.outstandingSatang).toBe(0);
    const paid = (await orderAction(f.actors.CASHIER, 'order.slip', printInput)) as OrderSlipDto;
    expect(paid.status).toBe('PAID');
    expect(
      await db.auditLog.count({ where: { entityId: order.id, action: 'ORDER_SLIP_REPRINT' } }),
    ).toBe(2);
  });

  it('enforces cashier ownership, event assignment, cancellation and QR revocation', async () => {
    const f = await salesFixture();
    const order = (await orderAction(f.actors.CASHIER, 'order.create', f.orderInput())) as {
      id: string;
    };
    const input = { orderId: order.id, eventId: f.event.id };
    await expect(orderAction(f.secondCashier, 'order.slip', input)).rejects.toThrow('not found');
    await expect(orderAction(f.actors.ADMIN, 'order.slip', input)).rejects.toThrow(
      'not authorized',
    );
    await expect(orderAction(f.actors.PAYMENT_CASHIER, 'order.slip', input)).rejects.toThrow(
      'not authorized',
    );
    await expect(
      orderAction(f.actors.CASHIER, 'order.slip', { ...input, eventId: randomUUID() }),
    ).rejects.toThrow();
    const slip = (await orderAction(f.actors.SUPER_ADMIN, 'order.slip', input)) as OrderSlipDto;
    const qr = decodePrintedCode(slip.qrImage);
    const lookup = (token: string) =>
      orderAction(f.actors.PAYMENT_CASHIER, 'account.lookup', { eventId: f.event.id, token });
    await expect(lookup(orderSlipQr(randomUUID(), f.registration.token))).rejects.toThrow(
      'Invalid or cancelled',
    );
    const other = (await registrationAction(f.actors.ADMIN, 'registration.create', {
      eventId: f.event.id,
      stationId: f.stations[0].id,
      customerName: 'Other customer',
    })) as { token: string };
    await expect(lookup(orderSlipQr(order.id, other.token))).rejects.toThrow(
      'Invalid or cancelled',
    );
    await db.qrCredential.update({
      where: { token: f.registration.token },
      data: { revokedAt: new Date() },
    });
    await expect(lookup(qr)).rejects.toThrow('revoked');
    await expect(orderAction(f.actors.CASHIER, 'order.slip', input)).rejects.toThrow('revoked');
    await db.qrCredential.update({
      where: { token: f.registration.token },
      data: { revokedAt: null },
    });
    await controlAction(f.actors.SUPER_ADMIN, 'order.void', {
      id: order.id,
      key: randomUUID(),
      reason: 'Purchase slip cancellation test',
    });
    await expect(lookup(qr)).rejects.toThrow('Invalid or cancelled');
    await expect(orderAction(f.actors.CASHIER, 'order.slip', input)).rejects.toThrow('Voided');
  });
});
