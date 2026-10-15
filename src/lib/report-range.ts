import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError } from './rbac';

export function reportRange(from?: string, to?: string) {
  if (from) z.iso.date().parse(from);
  if (to) z.iso.date().parse(to);
  const start = from ? new Date(`${from}T00:00:00+07:00`) : undefined;
  const end = to ? new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86400000) : undefined;
  if (
    (start && isNaN(start.getTime())) ||
    (end && isNaN(end.getTime())) ||
    (start && end && start >= end)
  )
    throw new AppError(400, 'Invalid date range.');
  const createdAt: Prisma.DateTimeFilter = {
    ...(start ? { gte: start } : {}),
    ...(end ? { lt: end } : {}),
  };
  return { start, end, createdAt };
}
export function paymentReportWhere(
  eventId: string,
  range: Prisma.DateTimeFilter = {},
): Prisma.PaymentWhereInput {
  return {
    eventId,
    ...(Object.keys(range).length
      ? {
          OR: [
            { status: 'CONFIRMED', confirmedAt: range },
            { status: { in: ['VOIDED', 'REFUNDED'] }, voidedAt: range },
            { status: { in: ['PENDING', 'AWAITING_CONFIRMATION', 'FAILED'] }, createdAt: range },
          ],
        }
      : {}),
  };
}
