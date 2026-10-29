import QRCode from 'qrcode';
import type { Tx } from './db';
import { audit, type Actor } from './audit';
import { AppError } from './rbac';
import { number } from './core';
import { promptPayPayload } from './promptpay';

export async function preparePayment(
  tx: Tx,
  actor: Actor,
  data: {
    eventId: string;
    stationId: string;
    accountId: string;
    shiftId: string;
    amountSatang: number;
    method: 'CASH' | 'PROMPTPAY';
    purpose?: 'SALE' | 'WALLET_TOPUP';
  },
) {
  const { method, amountSatang } = data;
  const settings = await tx.promptPaySetting.findUnique({ where: { id: 'primary' } });
  if (method === 'PROMPTPAY' && !settings?.enabled)
    throw new AppError(409, 'PromptPay has not been configured and enabled by the administrator.');
  const qrPayload =
    method === 'PROMPTPAY' && settings
      ? promptPayPayload(settings.type, settings.identifier, amountSatang)
      : '';
  const payment = await tx.payment.create({
    data: {
      number: await number(tx, 'PAY'),
      eventId: data.eventId,
      accountId: data.accountId,
      userId: actor.id,
      stationId: data.stationId,
      shiftId: data.shiftId,
      amountSatang,
      purpose: data.purpose ?? 'SALE',
      method,
      qrPayload,
      recipientNameSnapshot: method === 'PROMPTPAY' ? settings?.displayName : null,
    },
  });
  await audit(
    tx,
    actor,
    method === 'CASH' ? 'PAYMENT_CASH_PREPARE' : 'PAYMENT_QR_GENERATE',
    'Payment',
    payment.id,
    {
      eventId: data.eventId,
      stationId: data.stationId,
      after: {
        number: payment.number,
        accountId: data.accountId,
        amountSatang,
        status: payment.status,
        method: payment.method,
        purpose: payment.purpose,
      },
    },
  );
  return {
    ...payment,
    displayName: payment.recipientNameSnapshot ?? undefined,
    qrImage:
      method === 'PROMPTPAY'
        ? await QRCode.toDataURL(qrPayload, { width: 480, errorCorrectionLevel: 'M' })
        : undefined,
  };
}
