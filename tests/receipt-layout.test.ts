import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { decodePrintedCode } from './image-decode';
import { db } from '../src/lib/db';
import { salesFixture } from './sales-helpers';
import { orderAction } from '../src/lib/orders';
import { paymentAction } from '../src/lib/payments';
import { controlAction } from '../src/lib/controls';
import { operationsAction } from '../src/lib/operations';
import { manage } from '../src/lib/management';
import { readData } from '../src/lib/data';
import { receiptLayout } from '../src/lib/receipt-layout';
import type { ReceiptDto } from '../src/components/types';
import sharp from 'sharp';

afterAll(() => db.$disconnect());
describe('receipt layout and barcode reprints', () => {
  it('generates independently readable configurable QR and receipt barcodes without changing financial snapshots', async () => {
    const f = await salesFixture();
    const beforeSettings = (await readData(f.actors.SUPER_ADMIN, 'settings')) as Record<
      string,
      string
    >;
    try {
      const logo = `data:image/png;base64,${(
        await sharp({ create: { width: 80, height: 40, channels: 4, background: '#000000' } })
          .png()
          .toBuffer()
      ).toString('base64')}`;
      await manage(f.actors.SUPER_ADMIN, 'settings.save', {
        ...beforeSettings,
        receiptHeader: 'CCIDA EVENT RECEIPT',
        receiptFooter: 'Thank you',
        receiptQrValue: 'https://ccida.test/feedback',
        receiptQrLabel: 'Feedback',
        receiptLogo: logo,
      });
      await orderAction(f.actors.CASHIER, 'order.create', f.orderInput());
      const payment = (await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
        eventId: f.event.id,
        stationId: f.stations[3].id,
        token: f.registration.token,
        key: randomUUID(),
      })) as { id: string; number: string };
      await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', {
        paymentId: payment.id,
        stationId: f.stations[3].id,
        key: randomUUID(),
        reference: randomUUID(),
        evidence: 'Receipt integration evidence',
        evidenceVerified: true,
      });
      const original = await db.receipt.findUniqueOrThrow({ where: { paymentId: payment.id } });
      const printed = (await paymentAction(f.actors.PAYMENT_CASHIER, 'receipt.print', {
        paymentId: payment.id,
      })) as ReceiptDto;
      expect(printed.copy).toBe(false);
      expect(decodePrintedCode(printed.layout.qrImage!)).toBe('https://ccida.test/feedback');
      expect(decodePrintedCode(printed.layout.barcodeImage)).toBe(payment.number);
      expect(printed.layout.header).toBe('CCIDA EVENT RECEIPT');
      expect(printed.layout.logoImage).toBe(logo);
      await manage(f.actors.SUPER_ADMIN, 'settings.save', {
        organization: beforeSettings.organization,
      });
      expect(
        receiptLayout(
          (await db.systemSetting.findUniqueOrThrow({ where: { key: 'receipt-layout' } })).value,
        ).receiptQrValue,
      ).toBe('https://ccida.test/feedback');
      const reprinted = (await paymentAction(f.actors.PAYMENT_CASHIER, 'receipt.print', {
        receiptNumber: decodePrintedCode(printed.layout.barcodeImage),
      })) as ReceiptDto;
      expect(reprinted.copy).toBe(true);
      expect(reprinted.printCount).toBe(2);
      expect(reprinted.paymentId).toBe(payment.id);
      expect(reprinted.snapshot).toEqual(original.snapshot);
      expect(reprinted.layout.logoImage).toBe(logo);
      expect(await db.payment.count({ where: { accountId: f.registration.account.id } })).toBe(1);
      expect(
        await db.auditLog.count({ where: { entityId: original.id, action: 'RECEIPT_REPRINT' } }),
      ).toBe(1);
      for (const role of ['ADMIN', 'CASHIER', 'REGISTRATION_CASHIER'] as const)
        await expect(
          paymentAction(f.actors[role], 'receipt.print', { receiptNumber: payment.number }),
        ).rejects.toThrow('not authorized');
      await expect(
        manage(f.actors.PAYMENT_CASHIER, 'settings.save', {
          organization: beforeSettings.organization,
          receiptLogo: logo,
        }),
      ).rejects.toThrow('not authorized');
      await expect(
        manage(f.actors.SUPER_ADMIN, 'settings.save', {
          organization: beforeSettings.organization,
          receiptQrValue: 'ก'.repeat(100),
        }),
      ).rejects.toThrow('240 UTF-8');
      await controlAction(f.actors.SUPER_ADMIN, 'payment.void', {
        id: payment.id,
        key: randomUUID(),
        reason: 'Voided receipt regression',
      });
      await expect(
        paymentAction(f.actors.PAYMENT_CASHIER, 'receipt.print', { receiptNumber: payment.number }),
      ).rejects.toThrow('Only confirmed');
    } finally {
      await manage(f.actors.SUPER_ADMIN, 'settings.save', beforeSettings);
    }
  });

  it('finds a receipt by barcode after event closing and rejects invalid or missing numbers', async () => {
    const f = await salesFixture();
    await orderAction(f.actors.CASHIER, 'order.create', f.orderInput());
    const payment = (await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
      eventId: f.event.id,
      stationId: f.stations[3].id,
      token: f.registration.token,
      key: randomUUID(),
    })) as { id: string; number: string };
    await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', {
      paymentId: payment.id,
      stationId: f.stations[3].id,
      key: randomUUID(),
      reference: randomUUID(),
      evidence: 'Historical receipt evidence',
      evidenceVerified: true,
    });
    const shifts = await db.shift.findMany({ where: { eventId: f.event.id, closedAt: null } });
    for (const shift of shifts)
      await operationsAction(f.actors.SUPER_ADMIN, 'shift.close', {
        id: shift.id,
        reason: 'Historical barcode acceptance',
      });
    await operationsAction(f.actors.SUPER_ADMIN, 'event.close', { eventId: f.event.id });
    const printed = (await paymentAction(f.actors.PAYMENT_CASHIER, 'receipt.print', {
      receiptNumber: payment.number,
    })) as ReceiptDto;
    expect(printed.copy).toBe(true);
    expect(printed.snapshot.amountSatang).toBe(4550);
    expect(decodePrintedCode(printed.layout.barcodeImage)).toBe(payment.number);
    await expect(
      paymentAction(f.actors.PAYMENT_CASHIER, 'receipt.print', { receiptNumber: 'invalid' }),
    ).rejects.toThrow();
    await expect(
      paymentAction(f.actors.PAYMENT_CASHIER, 'receipt.print', {
        receiptNumber: 'PAY-19990101-999999999',
      }),
    ).rejects.toThrow();
  });
});
