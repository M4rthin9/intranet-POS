import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { salesFixture } from './sales-helpers';
import { db } from '../src/lib/db';
import { orderAction } from '../src/lib/orders';
import { paymentAction } from '../src/lib/payments';
import type { AccountDto, PaymentDto } from '../src/components/types';

afterAll(() => db.$disconnect());

describe('resume payment without scanning', () => {
  it.each(['CASH', 'PROMPTPAY'] as const)(
    'loads the existing %s payment and confirms once without a customer token',
    async (method) => {
      const f = await salesFixture();
      const settings = await db.promptPaySetting.findUnique({ where: { id: 'primary' } });
      try {
        if (method === 'PROMPTPAY')
          await paymentAction(f.actors.SUPER_ADMIN, 'promptpay.save', {
            type: 'PHONE',
            identifier: '0812345678',
            displayName: 'Original test recipient',
            enabled: true,
          });
        await orderAction(f.actors.CASHIER, 'order.create', f.orderInput(2));
        const payment = (await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.generate', {
          eventId: f.event.id,
          stationId: f.stations[3].id,
          token: f.registration.token,
          key: randomUUID(),
          method,
        })) as PaymentDto;
        const input = { eventId: f.event.id, stationId: f.stations[3].id, paymentId: payment.id };
        const before = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
        if (method === 'PROMPTPAY')
          await paymentAction(f.actors.SUPER_ADMIN, 'promptpay.save', {
            type: 'PHONE',
            identifier: '0899999999',
            displayName: 'Changed test recipient',
            enabled: true,
          });
        const resumed = (await paymentAction(
          f.actors.PAYMENT_CASHIER,
          'payment.resume',
          input,
        )) as { account: AccountDto; payment: PaymentDto };
        expect(resumed.account.id).toBe(f.registration.account.id);
        expect(resumed.account.outstandingSatang).toBe(9100);
        expect(resumed.payment).toMatchObject({
          id: payment.id,
          number: payment.number,
          method,
          amountSatang: 9100,
        });
        expect(resumed.payment.qrImage).toBe(payment.qrImage);
        if (method === 'PROMPTPAY')
          expect(resumed.payment.displayName).toBe('Original test recipient');
        expect(await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).toEqual(before);
        expect(await db.payment.count({ where: { accountId: f.registration.account.id } })).toBe(1);
        expect(await db.receipt.count({ where: { paymentId: payment.id } })).toBe(0);
        await expect(paymentAction(f.actors.CASHIER, 'payment.resume', input)).rejects.toThrow(
          'not authorized',
        );
        await expect(
          paymentAction(f.actors.PAYMENT_CASHIER, 'payment.resume', {
            ...input,
            eventId: f.fixtureEvent.id,
          }),
        ).rejects.toThrow('not assigned');
        await expect(
          paymentAction(f.actors.SUPER_ADMIN, 'payment.resume', {
            ...input,
            eventId: f.fixtureEvent.id,
          }),
        ).rejects.toThrow('not found');
        await expect(
          paymentAction(f.actors.PAYMENT_CASHIER, 'payment.resume', {
            ...input,
            stationId: f.stations[1].id,
          }),
        ).rejects.toThrow('wrong type');
        await db.customerAccount.update({
          where: { id: f.registration.account.id },
          data: { status: 'BLOCKED' },
        });
        await expect(
          paymentAction(f.actors.PAYMENT_CASHIER, 'payment.resume', input),
        ).rejects.toThrow('not awaiting');
        await db.customerAccount.update({
          where: { id: f.registration.account.id },
          data: { status: 'ACTIVE' },
        });
        const confirmation = {
          paymentId: resumed.payment.id,
          stationId: f.stations[3].id,
          key: randomUUID(),
          reference: `RESUME-${randomUUID()}`,
          evidence: 'Payment independently verified',
          evidenceVerified: true,
          ...(method === 'CASH' ? { cashReceivedSatang: 10000 } : {}),
        };
        await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', confirmation);
        await paymentAction(f.actors.PAYMENT_CASHIER, 'payment.confirm', confirmation);
        expect(await db.receipt.count({ where: { paymentId: payment.id } })).toBe(1);
        await expect(
          paymentAction(f.actors.PAYMENT_CASHIER, 'payment.resume', input),
        ).rejects.toThrow('not awaiting');
      } finally {
        if (method === 'PROMPTPAY') {
          if (settings) await paymentAction(f.actors.SUPER_ADMIN, 'promptpay.save', settings);
          else await db.promptPaySetting.deleteMany({ where: { id: 'primary' } });
        }
      }
    },
  );
});
