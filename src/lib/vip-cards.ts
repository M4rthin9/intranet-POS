import { db, transaction } from './db';
import { audit, type Actor } from './audit';
import { AppError } from './rbac';
import { requireAssignedEvent } from './event-assignment';
import { vipCardsPdf, vipCardImage } from './vip-card-pdf';
import { z } from 'zod';

export const vipExportSchema = z
  .object({
    registrationIds: z.array(z.string().uuid()).min(1).max(100),
    format: z.enum(['pdf', 'png', 'jpg']).default('pdf'),
    a4: z.boolean().default(false),
  })
  .refine(
    (value) => new Set(value.registrationIds).size === value.registrationIds.length,
    'Select each customer once.',
  )
  .refine(
    (value) => (value.a4 ? value.format === 'pdf' : value.registrationIds.length === 1),
    'Multiple customers require an A4 PDF.',
  );

export async function exportVipCards(actor: Actor, input: unknown) {
  if (!['SUPER_ADMIN', 'REGISTRATION_CASHIER'].includes(actor.roleName))
    throw new AppError(403, 'VIP cards may be printed by Super Admin or Registration Cashier.');
  const data = vipExportSchema.parse(input);
  const registrations = await transaction(async (tx) => {
    const values = await tx.registration.findMany({
      where: { id: { in: data.registrationIds } },
      include: {
        account: {
          include: {
            credentials: { where: { revokedAt: null }, orderBy: { issuedAt: 'desc' }, take: 1 },
          },
        },
      },
    });
    if (values.length !== data.registrationIds.length)
      throw new AppError(404, 'Registration not found.');
    if (new Set(values.map((value) => value.eventId)).size !== 1)
      throw new AppError(409, 'Select VIP customers from one event at a time.');
    const result = [];
    for (const id of data.registrationIds) {
      const value = values.find((value) => value.id === id)!;
      await requireAssignedEvent(tx, actor, value.eventId);
      if (!value.isVip)
        throw new AppError(409, 'Mark this customer as VIP before printing a welcome card.');
      if (
        !value.account ||
        !['ACTIVE', 'SETTLED'].includes(value.account.status) ||
        !value.account.credentials[0]
      )
        throw new AppError(409, 'This customer does not have an available QR credential.');
      result.push({
        id: value.id,
        number: value.number,
        eventId: value.eventId,
        credentialId: value.account.credentials[0].id,
        token: value.account.credentials[0].token,
      });
    }
    return result;
  });
  const file =
    data.format === 'pdf'
      ? await vipCardsPdf(
          registrations.map((value) => value.token),
          data.a4,
        )
      : await vipCardImage(registrations[0].token, data.format);
  await audit(db, actor, 'VIP_CARD_PRINT', 'Registration', registrations[0].id, {
    eventId: registrations[0].eventId,
    after: {
      cards: registrations.map(({ id, credentialId }) => ({ id, credentialId })),
      widthMm: 86,
      heightMm: 54,
      format: data.format,
      a4: data.a4,
    },
  });
  return {
    file,
    contentType:
      data.format === 'pdf'
        ? 'application/pdf'
        : data.format === 'png'
          ? 'image/png'
          : 'image/jpeg',
    filename: data.a4
      ? `VIP-A4-${registrations.length}-cards.pdf`
      : `VIP-${registrations[0].number}.${data.format}`,
  };
}

export async function vipWelcomeCard(actor: Actor, registrationId: string) {
  const result = await exportVipCards(actor, { registrationIds: [registrationId] });
  return { pdf: result.file, filename: result.filename };
}
