import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import QRCode from 'qrcode';
import { transaction, type Tx } from './db';
import { audit, type Actor } from './audit';
import { requirePermission, AppError } from './rbac';
import { number, openEvent, station } from './core';
import { requireAssignedEvent } from './event-assignment';
import { bulkRegistrationSchema } from './bulk-registration-schema';
import { idempotent } from './idempotency';
import { parseOrderSlipQr } from './order-slip-qr';
import { walletBalance } from './wallet';
const context = { eventId: z.string().uuid(), stationId: z.string().uuid() };
const customer = {
  customerName: z.string().min(1).max(120),
  phone: z.string().max(30).optional(),
  group: z.string().max(80).optional(),
  tableNumber: z.string().max(30).optional(),
  guestCount: z.number().int().min(1).max(500).default(1),
  isVip: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
};
export async function resolveAccount(tx: Tx, eventId: string, token: string, allowSettled = false) {
  const slip = parseOrderSlipQr(token);
  const credential = await tx.qrCredential.findUnique({
    where: { token: slip?.token ?? token },
    include: { account: { include: { registration: true } } },
  });
  if (!credential || credential.revokedAt || credential.account.registration.eventId !== eventId)
    throw new AppError(404, 'Invalid, revoked, or wrong-event QR.');
  const account = credential.account;
  if (account.status !== 'ACTIVE' && !(allowSettled && account.status === 'SETTLED'))
    throw new AppError(409, `Account ${account.status}. Ask the registration desk.`);
  const scannedOrder = slip
    ? await tx.order.findFirst({
        where: {
          id: slip.orderId,
          accountId: account.id,
          eventId,
          status: { in: ['RECORDED', 'PAID'] },
          clearedSale: { is: null },
        },
        select: { id: true, number: true, status: true },
      })
    : null;
  if (slip && !scannedOrder) throw new AppError(404, 'Invalid or cancelled purchase slip QR.');
  return { ...account, scannedOrder };
}
export async function registrationAction(actor: Actor, action: string, input: unknown) {
  if (action === 'event.save') {
    requirePermission(actor.roleName, 'event.manage');
    const data = z
      .object({
        id: z.string().uuid().optional(),
        code: z.string().min(1).max(40),
        name: z.string().min(1).max(160),
        status: z.enum(['DRAFT', 'OPEN']).default('DRAFT'),
        paymentMode: z.enum(['WALLET', 'INSTANT', 'PREPAID']).optional(),
      })
      .parse(input);
    return transaction(async (tx) => {
      const before = data.id ? await tx.event.findUniqueOrThrow({ where: { id: data.id } }) : null;
      if (before && !['DRAFT', 'OPEN'].includes(before.status))
        throw new AppError(409, 'Closed and archived events cannot be edited or reopened.');
      if (before?.status === 'OPEN' && data.status === 'DRAFT')
        throw new AppError(409, 'An open event cannot revert to draft.');
      if (
        before &&
        data.paymentMode &&
        before.paymentMode !== data.paymentMode &&
        ((await tx.order.count({ where: { eventId: before.id } })) ||
          (await tx.payment.count({ where: { eventId: before.id } })))
      )
        throw new AppError(409, 'Payment mode cannot change after sales or payments have started.');
      const { id, ...fields } = data;
      const value = id
        ? await tx.event.update({ where: { id }, data: fields })
        : await tx.event.create({ data: fields });
      await audit(
        tx,
        actor,
        !before ? 'EVENT_CREATE' : before.status !== value.status ? 'EVENT_OPEN' : 'EVENT_UPDATE',
        'Event',
        value.id,
        { eventId: value.id, before, after: value },
      );
      return value;
    });
  }
  if (action === 'registration.bulk.create') {
    requirePermission(actor.roleName, 'registration.create');
    const data = bulkRegistrationSchema.parse(input);
    return idempotent(actor, action, data.key, data, async (tx) => {
      await openEvent(tx, data.eventId);
      await requireAssignedEvent(tx, actor, data.eventId);
      await station(tx, data.stationId, 'REGISTRATION', actor.roleName);
      const registrations = [];
      for (const customerName of data.names) {
        const value = await tx.registration.create({
          data: {
            eventId: data.eventId,
            stationId: data.stationId,
            customerName,
            isVip: data.isVip,
            group: data.group,
            tableNumber: data.tableNumber,
            number: await number(tx, 'REG'),
            createdById: actor.id,
            account: {
              create: {
                credentials: {
                  create: {
                    token: `CCA-${randomBytes(32).toString('base64url')}`,
                    issuedBy: actor.id,
                  },
                },
              },
            },
          },
          include: { account: { include: { credentials: true } } },
        });
        await audit(tx, actor, 'REGISTRATION_CREATE', 'Registration', value.id, {
          eventId: data.eventId,
          stationId: data.stationId,
          after: { number: value.number, customerName, isVip: value.isVip, bulkKey: data.key },
        });
        await audit(tx, actor, 'QR_CREATE', 'CustomerAccount', value.account!.id, {
          eventId: data.eventId,
          stationId: data.stationId,
          after: { credentialId: value.account!.credentials[0].id },
        });
        registrations.push({
          id: value.id,
          number: value.number,
          customerName,
          isVip: value.isVip,
        });
      }
      return { registrations };
    });
  }
  if (action === 'registration.create') {
    requirePermission(actor.roleName, 'registration.create');
    const data = z.object({ ...context, ...customer }).parse(input);
    return transaction(async (tx) => {
      const event = await openEvent(tx, data.eventId);
      await requireAssignedEvent(tx, actor, data.eventId);
      await station(tx, data.stationId, 'REGISTRATION', actor.roleName);
      const token = `CCA-${randomBytes(32).toString('base64url')}`;
      const value = await tx.registration.create({
        data: {
          ...data,
          number: await number(tx, 'REG'),
          createdById: actor.id,
          account: { create: { credentials: { create: { token, issuedBy: actor.id } } } },
        },
        include: { account: { include: { credentials: true } } },
      });
      await audit(tx, actor, 'REGISTRATION_CREATE', 'Registration', value.id, {
        eventId: data.eventId,
        stationId: data.stationId,
        after: { number: value.number, customerName: value.customerName, isVip: value.isVip },
      });
      await audit(tx, actor, 'QR_CREATE', 'CustomerAccount', value.account!.id, {
        eventId: data.eventId,
        stationId: data.stationId,
        after: { credentialId: value.account!.credentials[0].id },
      });
      return {
        ...value,
        registrationId: value.id,
        event: { code: event.code, name: event.name },
        issuedAt: value.account!.credentials[0].issuedAt.toISOString(),
        token,
        qrImage: await QRCode.toDataURL(token, { width: 480, errorCorrectionLevel: 'M' }),
      };
    });
  }
  if (action === 'registration.update') {
    requirePermission(actor.roleName, 'registration.update');
    const data = z
      .object({
        id: z.string().uuid(),
        ...customer,
        status: z.enum(['ACTIVE', 'BLOCKED', 'CANCELLED', 'EXPIRED']).optional(),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(input);
    return transaction(async (tx) => {
      const before = await tx.registration.findUniqueOrThrow({
        where: { id: data.id },
        include: { account: true },
      });
      await openEvent(tx, before.eventId);
      await requireAssignedEvent(tx, actor, before.eventId);
      if (before.account?.status === 'SETTLED' && data.status)
        throw new AppError(409, 'Only a super administrator may reopen a settled account.');
      if (
        data.status &&
        ['CANCELLED', 'EXPIRED'].includes(data.status) &&
        before.account &&
        (await walletBalance(tx, before.account.id)) > 0
      )
        throw new AppError(
          409,
          'Unused wallet credit must be spent or refunded before cancelling or expiring this account.',
        );
      if (
        data.status &&
        ['CANCELLED', 'EXPIRED'].includes(data.status) &&
        (await tx.order.count({ where: { accountId: before.account!.id, status: 'RECORDED' } }))
      )
        throw new AppError(409, 'Cannot cancel or expire an account with unpaid orders.');
      const { id, status, reason, ...fields } = data;
      const value = await tx.registration.update({
        where: { id },
        data: { ...fields, ...(status ? { account: { update: { status } } } : {}) },
        include: { account: true },
      });
      await audit(tx, actor, 'REGISTRATION_UPDATE', 'Registration', id, {
        eventId: before.eventId,
        before,
        after: value,
        reason,
      });
      return value;
    });
  }
  if (['qr.print', 'qr.block', 'qr.reissue'].includes(action)) {
    requirePermission(
      actor.roleName,
      action === 'qr.print'
        ? 'registration.qr.reprint'
        : action === 'qr.block'
          ? 'registration.qr.block'
          : 'registration.qr.reissue',
    );
    const data = z
      .object({
        registrationId: z.string().uuid(),
        reason: z.string().trim().min(3).max(500).optional(),
      })
      .parse(input);
    return transaction(async (tx) => {
      const registration = await tx.registration.findUniqueOrThrow({
        where: { id: data.registrationId },
        include: {
          event: { select: { code: true, name: true } },
          account: { include: { credentials: { orderBy: { issuedAt: 'desc' } } } },
        },
      });
      const account = registration.account!;
      await requireAssignedEvent(tx, actor, registration.eventId);
      if (action !== 'qr.print') {
        await openEvent(tx, registration.eventId);
        if (!data.reason) throw new AppError(400, 'A reason is required.');
        if (['SETTLED', 'CANCELLED', 'EXPIRED'].includes(account.status))
          throw new AppError(409, 'Account status does not permit QR changes.');
      }
      if (action === 'qr.block') {
        await tx.customerAccount.update({ where: { id: account.id }, data: { status: 'BLOCKED' } });
        await audit(tx, actor, 'QR_BLOCK', 'CustomerAccount', account.id, {
          eventId: registration.eventId,
          before: { status: account.status },
          after: { status: 'BLOCKED' },
          reason: data.reason,
        });
        return { ok: true };
      }
      let current = account.credentials.find((c) => !c.revokedAt);
      if (action === 'qr.reissue') {
        await tx.qrCredential.updateMany({
          where: { accountId: account.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        current = await tx.qrCredential.create({
          data: {
            accountId: account.id,
            token: `CCA-${randomBytes(32).toString('base64url')}`,
            issuedBy: actor.id,
            reason: data.reason,
          },
        });
      }
      if (!current) throw new AppError(409, 'No active QR credential.');
      await audit(
        tx,
        actor,
        action === 'qr.reissue' ? 'QR_REISSUE' : 'QR_REPRINT',
        'CustomerAccount',
        account.id,
        { eventId: registration.eventId, after: { credentialId: current.id }, reason: data.reason },
      );
      return {
        number: registration.number,
        registrationId: registration.id,
        customerName: registration.customerName,
        event: registration.event,
        issuedAt: current.issuedAt.toISOString(),
        token: current.token,
        qrImage: await QRCode.toDataURL(current.token, { width: 480, errorCorrectionLevel: 'M' }),
      };
    });
  }
  throw new AppError(404, 'Unknown registration operation.');
}
