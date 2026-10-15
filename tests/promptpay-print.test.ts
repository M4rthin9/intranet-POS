import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { db } from '../src/lib/db';
import { salesFixture } from './sales-helpers';
import { orderAction } from '../src/lib/orders';
import { paymentAction } from '../src/lib/payments';
import { controlAction } from '../src/lib/controls';
import { promptPayPayload } from '../src/lib/promptpay';
import type { PromptPayPrintDto } from '../src/components/types';

afterAll(() => db.$disconnect());
describe('audited PromptPay QR printing', () => {
  it('prints the original pending payload and recipient without creating or confirming payment', async () => {
    const f = await salesFixture();
    const originalSettings = await db.promptPaySetting.findUnique({ where: { id: 'primary' } });
    try {
      await paymentAction(f.actors.SUPER_ADMIN, 'promptpay.save', {
        type: 'PHONE',
        identifier: '0812345678',
        displayName: 'ORIGINAL PRINT TEST RECIPIENT',
        enabled: true,
      });
      await orderAction(f.actors.CASHIER, 'order.create', f.orderInput());
      const payment = (await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
        eventId: f.event.id,
        stationId: f.stations[3].id,
        token: f.registration.token,
        key: randomUUID(),
      })) as { id: string; qrPayload: string };
      await paymentAction(f.actors.SUPER_ADMIN, 'promptpay.save', {
        type: 'PHONE',
        identifier: '0823456789',
        displayName: 'CHANGED PRINT TEST RECIPIENT',
        enabled: true,
      });
      const input = { paymentId: payment.id, stationId: f.stations[3].id };
      for (let index = 0; index < 2; index++) {
        const printed = (await paymentAction(
          f.actors.PAYMENT_CASHIER,
          'payment.qr.print',
          input,
        )) as PromptPayPrintDto;
        expect(printed.amountSatang).toBe(4550);
        expect(printed.recipientName).toBe('ORIGINAL PRINT TEST RECIPIENT');
        expect(printed.qrImage).toBe(
          await QRCode.toDataURL(payment.qrPayload, { width: 480, errorCorrectionLevel: 'M' }),
        );
      }
      expect(await db.payment.count({ where: { accountId: f.registration.account.id } })).toBe(1);
      expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'AWAITING_CONFIRMATION',
      );
      expect(
        (await db.customerAccount.findUniqueOrThrow({ where: { id: f.registration.account.id } }))
          .status,
      ).toBe('ACTIVE');
      expect(await db.receipt.count({ where: { paymentId: payment.id } })).toBe(0);
      expect(await db.paymentAllocation.count({ where: { paymentId: payment.id } })).toBe(0);
      expect(
        await db.auditLog.count({ where: { action: 'PAYMENT_QR_PRINT', entityId: payment.id } }),
      ).toBe(2);
      for (const role of ['ADMIN', 'CASHIER', 'REGISTRATION_CASHIER'] as const)
        await expect(paymentAction(f.actors[role], 'payment.qr.print', input)).rejects.toThrow(
          'not authorized',
        );
      await expect(
        db.payment.update({
          where: { id: payment.id },
          data: { recipientNameSnapshot: 'tampered' },
        }),
      ).rejects.toThrow('immutable');
      await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', {
        ...input,
        key: randomUUID(),
        reference: randomUUID(),
        evidence: 'Isolated print regression evidence',
        evidenceVerified: true,
      });
      await expect(
        paymentAction(f.actors.PAYMENT_CASHIER, 'payment.qr.print', input),
      ).rejects.toThrow('pending payment');
    } finally {
      if (originalSettings)
        await paymentAction(f.actors.SUPER_ADMIN, 'promptpay.save', originalSettings);
    }
  });

  it('recovers legacy recipient metadata without rewriting old rows, and rejects voided QR printing', async () => {
    const f = await salesFixture();
    await orderAction(f.actors.CASHIER, 'order.create', f.orderInput());
    const shift = await db.shift.findFirstOrThrow({
      where: { userId: f.actors.PAYMENT_CASHIER.id, closedAt: null },
    });
    const payment = await db.payment.create({
      data: {
        number: `PAY-LEGACY-${f.tag}`,
        eventId: f.event.id,
        accountId: f.registration.account.id,
        userId: f.actors.PAYMENT_CASHIER.id,
        stationId: shift.stationId,
        shiftId: shift.id,
        amountSatang: 4550,
        qrPayload: promptPayPayload('PHONE', '0812345678', 4550),
      },
    });
    await db.idempotencyRecord.create({
      data: {
        key: createHash('sha256').update(randomUUID()).digest('hex'),
        actorUserId: f.actors.PAYMENT_CASHIER.id,
        action: 'payment.generate',
        requestHash: 'a'.repeat(64),
        response: { id: payment.id, displayName: 'LEGACY TEST RECIPIENT' },
      },
    });
    const input = { paymentId: payment.id, stationId: shift.stationId };
    const printed = (await paymentAction(
      f.actors.PAYMENT_CASHIER,
      'payment.qr.print',
      input,
    )) as PromptPayPrintDto;
    expect(printed.recipientName).toBe('LEGACY TEST RECIPIENT');
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).recipientNameSnapshot,
    ).toBeNull();
    await controlAction(f.actors.SUPER_ADMIN, 'payment.void', {
      id: payment.id,
      key: randomUUID(),
      reason: 'Void isolated printing fixture',
    });
    await expect(
      paymentAction(f.actors.PAYMENT_CASHIER, 'payment.qr.print', input),
    ).rejects.toThrow('pending payment');
  });
});
