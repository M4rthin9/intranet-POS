import { z } from 'zod';
import QRCode from 'qrcode';
import { transaction } from './db';
import { audit, type Actor } from './audit';
import { requirePermission, AppError } from './rbac';
import { resolveAccount } from './registration';
import { openEvent, station, shift, number } from './core';
import { requireAssignedEvent } from './event-assignment';
import { idempotent } from './idempotency';
import { sumMoney, bahtString } from './money';
import { validateIdentifier } from './promptpay';
import { receiptPresentation } from './receipt-layout';
import { accountDetail } from './account-detail';
import { preparePayment } from './payment-preparation';
import { isPosCashier, usesInstantPos } from './pos-mode';
export async function paymentAction(actor: Actor, action: string, input: unknown) {
  if (action === 'payment.method.change') {
    if (actor.roleName !== 'SUPER_ADMIN')
      throw new AppError(403, 'Only a super administrator can change a payment method.');
    const data = z
      .object({
        eventId: z.string().uuid(),
        stationId: z.string().uuid(),
        paymentId: z.string().uuid(),
        key: z.string().uuid(),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(input);
    return idempotent(actor, action, data.key, data, async (tx) => {
      await openEvent(tx, data.eventId);
      await station(tx, data.stationId, 'PAYMENT', actor.roleName);
      const before = await tx.payment.findFirst({
        where: { id: data.paymentId, eventId: data.eventId, clearedSale: { is: null } },
        include: { account: true },
      });
      if (!before) throw new AppError(404, 'Payment not found.');
      if (
        !['PENDING', 'AWAITING_CONFIRMATION'].includes(before.status) ||
        before.account.status !== 'ACTIVE'
      )
        throw new AppError(409, 'Only an unpaid pending payment can be changed to cash.');
      const orders = await tx.order.findMany({
        where: { accountId: before.accountId, status: 'RECORDED' },
        select: { totalSatang: true },
      });
      if (
        !orders.length ||
        sumMoney(orders.map((order) => order.totalSatang)) !== before.amountSatang
      )
        throw new AppError(409, 'Outstanding changed. Correct the pending payment first.');
      if (before.method !== 'PROMPTPAY')
        throw new AppError(409, 'Only PromptPay payments can be changed to cash.');
      const currentShift = await shift(tx, actor, data.eventId, data.stationId);
      await tx.payment.update({
        where: { id: before.id },
        data: {
          status: 'VOIDED',
          voidReason: data.reason,
          voidedAt: new Date(),
          voidedBy: actor.id,
        },
      });
      const payment = await tx.payment.create({
        data: {
          number: await number(tx, 'PAY'),
          eventId: before.eventId,
          accountId: before.accountId,
          userId: actor.id,
          stationId: data.stationId,
          shiftId: currentShift.id,
          amountSatang: before.amountSatang,
          method: 'CASH',
          qrPayload: '',
        },
      });
      await audit(tx, actor, 'PAYMENT_METHOD_CHANGE', 'Payment', payment.id, {
        eventId: payment.eventId,
        stationId: data.stationId,
        before: {
          paymentId: before.id,
          number: before.number,
          method: before.method,
          status: before.status,
          qrPayload: before.qrPayload,
          recipientNameSnapshot: before.recipientNameSnapshot,
        },
        after: {
          paymentId: payment.id,
          number: payment.number,
          method: payment.method,
          status: payment.status,
          amountSatang: payment.amountSatang,
        },
        reason: data.reason,
      });
      return { ...payment, qrImage: undefined, displayName: undefined };
    });
  }
  if (action === 'payment.resume' || action === 'payment.pos.resume') {
    const pos = action === 'payment.pos.resume';
    requirePermission(actor.roleName, pos ? 'order.create' : 'payment.confirm');
    const data = z
      .object({
        eventId: z.string().uuid(),
        stationId: z.string().uuid(),
        paymentId: z.string().uuid(),
      })
      .parse(input);
    return transaction(async (tx) => {
      await requireAssignedEvent(tx, actor, data.eventId);
      const event = await openEvent(tx, data.eventId);
      await station(tx, data.stationId, pos ? 'POS' : 'PAYMENT', actor.roleName);
      const payment = await tx.payment.findFirst({
        where: { id: data.paymentId, eventId: data.eventId, clearedSale: { is: null } },
        include: { account: { include: { registration: true } } },
      });
      if (!payment) throw new AppError(404, 'Payment not found in this event.');
      if (
        pos &&
        (!usesInstantPos(actor.roleName, event) ||
          payment.userId !== actor.id ||
          payment.stationId !== data.stationId)
      )
        throw new AppError(403, 'This instant payment does not belong to your POS session.');
      if (
        !['PENDING', 'AWAITING_CONFIRMATION'].includes(payment.status) ||
        payment.account.status !== 'ACTIVE'
      )
        throw new AppError(409, 'Payment/account is not awaiting confirmation.');
      const account = await accountDetail(tx, { ...payment.account, scannedOrder: null });
      if (!account.outstandingSatang || account.outstandingSatang !== payment.amountSatang)
        throw new AppError(
          409,
          'Outstanding changed. Ask a super administrator to correct the payment.',
        );
      await shift(tx, actor, data.eventId, data.stationId);
      return {
        account,
        payment: {
          id: payment.id,
          number: payment.number,
          method: payment.method,
          status: payment.status,
          amountSatang: payment.amountSatang,
          createdAt: payment.createdAt,
          confirmedAt: payment.confirmedAt,
          displayName: payment.recipientNameSnapshot ?? undefined,
          qrImage:
            payment.method === 'PROMPTPAY'
              ? await QRCode.toDataURL(payment.qrPayload, { width: 480, errorCorrectionLevel: 'M' })
              : undefined,
        },
      };
    });
  }
  if (action === 'promptpay.save') {
    requirePermission(actor.roleName, 'settings.manage');
    const data = z
      .object({
        type: z.enum(['PHONE', 'TAX_ID', 'EWALLET']),
        identifier: z.string().max(15),
        displayName: z.string().min(1).max(120),
        enabled: z.boolean(),
      })
      .parse(input);
    validateIdentifier(data.type, data.identifier);
    return transaction(async (tx) => {
      const before = await tx.promptPaySetting.findUnique({ where: { id: 'primary' } });
      await tx.promptPaySetting.upsert({
        where: { id: 'primary' },
        create: data,
        update: data,
      });
      await audit(tx, actor, 'SETTINGS_UPDATE', 'PromptPaySetting', 'primary', {
        before: before
          ? { type: before.type, displayName: before.displayName, enabled: before.enabled }
          : undefined,
        after: { type: data.type, displayName: data.displayName, enabled: data.enabled },
      });
      return { ok: true };
    });
  }
  if (action === 'payment.generate') {
    requirePermission(actor.roleName, 'payment.promptpay.create');
    const data = z
      .object({
        eventId: z.string().uuid(),
        stationId: z.string().uuid(),
        token: z.string().min(10).max(100),
        key: z.string().uuid(),
        method: z.enum(['PROMPTPAY', 'CASH']).optional(),
      })
      .parse(input);
    return idempotent(actor, action, data.key, data, async (tx) => {
      const method = data.method ?? 'PROMPTPAY';
      await openEvent(tx, data.eventId);
      await station(tx, data.stationId, 'PAYMENT', actor.roleName);
      const currentShift = await shift(tx, actor, data.eventId, data.stationId);
      const account = await resolveAccount(tx, data.eventId, data.token);
      const existing = await tx.payment.findFirst({
        where: { accountId: account.id, status: { in: ['PENDING', 'AWAITING_CONFIRMATION'] } },
      });
      if (existing) {
        if (existing.method !== method)
          throw new AppError(
            409,
            'A payment is already pending using another method. Complete or void it before changing method.',
          );
        return {
          ...existing,
          displayName: existing.recipientNameSnapshot ?? undefined,
          qrImage:
            existing.method === 'PROMPTPAY'
              ? await QRCode.toDataURL(existing.qrPayload, {
                  width: 480,
                  errorCorrectionLevel: 'M',
                })
              : undefined,
        };
      }
      const orders = await tx.order.findMany({
        where: { accountId: account.id, status: 'RECORDED' },
      });
      const amountSatang = sumMoney(orders.map((o) => o.totalSatang));
      if (!amountSatang) throw new AppError(409, 'No unpaid orders.');
      return preparePayment(tx, actor, {
        eventId: data.eventId,
        stationId: data.stationId,
        accountId: account.id,
        shiftId: currentShift.id,
        amountSatang,
        method,
      });
    });
  }
  if (action === 'payment.qr.print') {
    requirePermission(actor.roleName, 'payment.promptpay.print');
    const data = z
      .object({ paymentId: z.string().uuid(), stationId: z.string().uuid() })
      .parse(input);
    return transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: data.paymentId },
        include: { account: { include: { registration: true } } },
      });
      await openEvent(tx, payment.eventId);
      await station(tx, data.stationId, 'PAYMENT', actor.roleName);
      await shift(tx, actor, payment.eventId, data.stationId);
      if (payment.method !== 'PROMPTPAY')
        throw new AppError(409, 'Cash payments do not have a PromptPay QR.');
      if (
        !['PENDING', 'AWAITING_CONFIRMATION'].includes(payment.status) ||
        payment.account.status !== 'ACTIVE'
      )
        throw new AppError(
          409,
          'Only an active pending payment QR can be printed. Rescan the customer account.',
        );
      const orders = await tx.order.findMany({
        where: { accountId: payment.accountId, status: 'RECORDED' },
        select: { totalSatang: true },
      });
      if (
        !orders.length ||
        sumMoney(orders.map((order) => order.totalSatang)) !== payment.amountSatang
      )
        throw new AppError(
          409,
          'Outstanding changed. Ask a super administrator to correct the payment before printing.',
        );
      let recipientName = payment.recipientNameSnapshot;
      if (!recipientName) {
        // Older payments keep their immutable facts. Recover the name from their original reply.
        const original = await tx.idempotencyRecord.findFirst({
          where: { action: 'payment.generate', response: { path: ['id'], equals: payment.id } },
          orderBy: { createdAt: 'asc' },
          select: { response: true },
        });
        const legacy = z
          .object({ displayName: z.string().min(1).max(120) })
          .safeParse(original?.response);
        if (legacy.success) recipientName = legacy.data.displayName;
      }
      const result = {
        paymentId: payment.id,
        number: payment.number,
        amountSatang: payment.amountSatang,
        registrationNumber: payment.account.registration.number,
        customerName: payment.account.registration.customerName,
        recipientName,
        qrImage: await QRCode.toDataURL(payment.qrPayload, {
          width: 480,
          errorCorrectionLevel: 'M',
        }),
      };
      await audit(tx, actor, 'PAYMENT_QR_PRINT', 'Payment', payment.id, {
        eventId: payment.eventId,
        stationId: data.stationId,
        after: {
          number: payment.number,
          amountSatang: payment.amountSatang,
          recipientName,
          status: payment.status,
        },
      });
      return result;
    });
  }
  if (action === 'payment.confirm' || action === 'payment.pos.confirm') {
    const pos = action === 'payment.pos.confirm';
    requirePermission(actor.roleName, pos ? 'order.create' : 'payment.confirm');
    const data = z
      .object({
        paymentId: z.string().uuid(),
        stationId: z.string().uuid(),
        key: z.string().uuid(),
        reference: z.string().trim().min(3).max(120),
        evidence: z.string().trim().min(3).max(1000),
        evidenceVerified: z.literal(true),
        cashReceivedSatang: z.number().int().nonnegative().max(2147483647).optional(),
      })
      .parse(input);
    return idempotent(actor, action, data.key, data, async (tx) => {
      const before = await tx.payment.findUniqueOrThrow({
        where: { id: data.paymentId },
        include: { account: { include: { registration: true } } },
      });
      const eventContext = await openEvent(tx, before.eventId);
      if (
        pos &&
        (!usesInstantPos(actor.roleName, eventContext) ||
          before.userId !== actor.id ||
          before.stationId !== data.stationId)
      )
        throw new AppError(403, 'This instant payment does not belong to your POS session.');
      await station(tx, data.stationId, pos ? 'POS' : 'PAYMENT', actor.roleName);
      const currentShift = await shift(tx, actor, before.eventId, data.stationId);
      if (before.status === 'CONFIRMED') {
        const receipt = await tx.receipt.findUniqueOrThrow({ where: { paymentId: before.id } });
        return { payment: before, receipt };
      }
      if (
        !['PENDING', 'AWAITING_CONFIRMATION'].includes(before.status) ||
        before.account.status !== 'ACTIVE'
      )
        throw new AppError(409, 'Payment/account is not awaiting confirmation.');
      const orders = await tx.order.findMany({
        where: { accountId: before.accountId, status: 'RECORDED' },
        include: { items: true, station: { select: { code: true } } },
        orderBy: { createdAt: 'asc' },
      });
      const total = sumMoney(orders.map((o) => o.totalSatang));
      if (total !== before.amountSatang || !orders.length)
        throw new AppError(
          409,
          'Outstanding changed. Ask a super administrator to void and regenerate the payment.',
        );
      if (
        before.method === 'CASH' &&
        (data.cashReceivedSatang === undefined || data.cashReceivedSatang < total)
      )
        throw new AppError(400, 'Cash received must cover the full outstanding amount.');
      if (before.method !== 'CASH' && data.cashReceivedSatang !== undefined)
        throw new AppError(400, 'Cash received is only valid for cash payments.');
      const cash =
        before.method === 'CASH'
          ? {
              cashReceivedSatang: data.cashReceivedSatang!,
              changeSatang: data.cashReceivedSatang! - total,
            }
          : {};
      const confirmedAt = new Date();
      const payment = await tx.payment.update({
        where: { id: before.id },
        data: {
          status: 'CONFIRMED',
          reference: before.method === 'CASH' ? `CASH-${before.number}` : data.reference,
          evidence:
            before.method === 'CASH'
              ? `${data.evidence} · Received THB ${bahtString(data.cashReceivedSatang!)} · Change THB ${bahtString(data.cashReceivedSatang! - total)}`
              : data.evidence,
          confirmedAt,
          userId: actor.id,
          stationId: data.stationId,
          shiftId: currentShift.id,
        },
      });
      await tx.paymentAllocation.createMany({
        data: orders.map((o) => ({
          paymentId: payment.id,
          orderId: o.id,
          amountSatang: o.totalSatang,
        })),
      });
      await tx.order.updateMany({
        where: { id: { in: orders.map((o) => o.id) } },
        data: { status: 'PAID' },
      });
      await tx.customerAccount.update({
        where: { id: before.accountId },
        data: { status: 'SETTLED' },
      });
      const event = await tx.event.findUniqueOrThrow({ where: { id: before.eventId } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
      const st = await tx.station.findUniqueOrThrow({ where: { id: data.stationId } });
      const organization =
        (await tx.systemSetting.findUnique({ where: { key: 'organization' } }))?.value ??
        'ทัณฑสถานบำบัดพิเศษกลาง';
      const snapshot = JSON.parse(
        JSON.stringify({
          organization,
          event: event.name,
          eventCode: event.code,
          number: payment.number,
          registrationNumber: before.account.registration.number,
          customerName: before.account.registration.customerName,
          orders: orders.map((o) => ({
            number: o.number,
            station: o.station.code,
            totalSatang: o.totalSatang,
            items: o.items,
          })),
          amountSatang: payment.amountSatang,
          method: payment.method,
          ...cash,
          reference: payment.reference,
          confirmedAt,
          user: user.displayName,
          station: st.code,
        }),
      );
      const receipt = await tx.receipt.create({ data: { paymentId: payment.id, snapshot } });
      await audit(tx, actor, 'PAYMENT_CONFIRM', 'Payment', payment.id, {
        eventId: payment.eventId,
        stationId: data.stationId,
        before: { status: before.status },
        after: {
          status: payment.status,
          amountSatang: payment.amountSatang,
          method: payment.method,
          ...cash,
          reference: payment.reference,
          orderIds: orders.map((o) => o.id),
          accountStatus: 'SETTLED',
        },
      });
      return { payment, receipt };
    });
  }
  if (action === 'receipt.print') {
    if (!isPosCashier(actor.roleName)) requirePermission(actor.roleName, 'payment.receipt.print');
    const data = z
      .union([
        z.object({ paymentId: z.string().uuid() }),
        z.object({
          receiptNumber: z
            .string()
            .trim()
            .regex(/^PAY-\d{8}-\d{6,20}$/),
        }),
      ])
      .parse(input);
    const barcodeReprint = 'receiptNumber' in data;
    if (barcodeReprint && !isPosCashier(actor.roleName))
      requirePermission(actor.roleName, 'payment.receipt.reprint');
    return transaction(async (tx) => {
      const before = await tx.receipt.findFirstOrThrow({
        where:
          'paymentId' in data
            ? { paymentId: data.paymentId }
            : { payment: { number: data.receiptNumber } },
        include: { payment: { include: { event: true } } },
      });
      if (
        isPosCashier(actor.roleName) &&
        (before.payment.userId !== actor.id ||
          !usesInstantPos(actor.roleName, before.payment.event))
      )
        throw new AppError(403, 'You may only print your own instant POS receipts.');
      if (before.payment.status !== 'CONFIRMED')
        throw new AppError(409, 'Only confirmed payments can be printed.');
      await requireAssignedEvent(tx, actor, before.payment.eventId);
      const copy = barcodeReprint || before.printCount > 0;
      if (copy && !isPosCashier(actor.roleName))
        requirePermission(actor.roleName, 'payment.receipt.reprint');
      const receipt = await tx.receipt.update({
        where: { id: before.id },
        data: { printCount: { increment: 1 } },
      });
      await audit(tx, actor, copy ? 'RECEIPT_REPRINT' : 'RECEIPT_PRINT', 'Receipt', receipt.id, {
        eventId: before.payment.eventId,
        stationId: before.payment.stationId,
        after: { printCount: receipt.printCount },
      });
      return {
        paymentId: before.payment.id,
        snapshot: receipt.snapshot,
        copy,
        printCount: receipt.printCount,
        printedAt: new Date().toISOString(),
        layout: await receiptPresentation(
          before.payment.number,
          (await tx.systemSetting.findUnique({ where: { key: 'receipt-layout' } }))?.value,
        ),
      };
    });
  }
  throw new AppError(404, 'Unknown payment operation.');
}
