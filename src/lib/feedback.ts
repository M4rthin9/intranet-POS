import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db, transaction } from './db';
import type { Actor } from './audit';
import { AppError, requirePermission } from './rbac';
import { feedbackInputSchema } from './feedback-schema';
import { receiptLayout } from './receipt-layout';

export async function feedbackFormData(eventId?: string) {
  const requested = eventId ? z.string().uuid().safeParse(eventId) : null;
  if (requested && !requested.success) throw new AppError(404, 'Feedback event not found.');
  const selected = eventId
    ? await db.event.findFirst({
        where: { id: eventId, status: { in: ['OPEN', 'CLOSED'] } },
        select: { id: true, code: true, name: true },
      })
    : null;
  if (eventId && !selected) throw new AppError(404, 'Feedback event not found.');
  const [events, organization, layout] = await Promise.all([
    db.event.findMany({
      where: { status: { in: ['OPEN', 'CLOSED'] } },
      select: { id: true, code: true, name: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    db.systemSetting.findUnique({ where: { key: 'organization' } }),
    db.systemSetting.findUnique({ where: { key: 'receipt-layout' } }),
  ]);
  if (selected && !events.some((event) => event.id === selected.id)) events.unshift(selected);
  return {
    events,
    selectedEventId: selected?.id ?? '',
    organization:
      typeof organization?.value === 'string' ? organization.value : 'ทัณฑสถานบำบัดพิเศษกลาง',
    logo: receiptLayout(layout?.value).receiptLogo,
  };
}

export async function submitFeedback(input: unknown) {
  const data = feedbackInputSchema.parse(input);
  const { key, website: _website, ...content } = data;
  void _website;
  const requestHash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  const received = { received: true };
  const replay = (previous: { requestHash: string }) => {
    if (previous.requestHash !== requestHash)
      throw new AppError(409, 'รหัสคำขอนี้ใช้ส่งข้อมูลอื่นแล้ว กรุณาตรวจสอบรายการเดิม');
    return received;
  };
  const previous = await db.feedback.findUnique({ where: { submissionKey: key } });
  if (previous) return replay(previous);

  // A shared minute bucket also bounds traffic when the app is served directly
  // and a trusted client IP is unavailable. No customer IP is stored.
  const limited = await db.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RateLimit" ("key", "count", "windowStart") VALUES ('feedback:submit:minute', 1, NOW())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" < NOW() - INTERVAL '1 minute' THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."windowStart" < NOW() - INTERVAL '1 minute' THEN NOW() ELSE "RateLimit"."windowStart" END
    RETURNING "count"`;
  if (limited[0].count > 120)
    throw new AppError(429, 'มีผู้ส่งความคิดเห็นจำนวนมาก กรุณารอสักครู่แล้วลองรายการเดิมอีกครั้ง');

  return transaction(async (tx) => {
    const existing = await tx.feedback.findUnique({ where: { submissionKey: key } });
    if (existing) return replay(existing);
    if (
      content.eventId &&
      !(await tx.event.findFirst({
        where: { id: content.eventId, status: { in: ['OPEN', 'CLOSED'] } },
      }))
    )
      throw new AppError(404, 'กิจกรรมนี้ไม่เปิดรับความคิดเห็น กรุณาตรวจสอบลิงก์');
    const feedback = await tx.feedback.create({
      data: {
        ...content,
        customerName: content.customerName || null,
        contact: content.contact || null,
        submissionKey: key,
        requestHash,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: 'public-feedback',
        actorRole: 'PUBLIC',
        action: 'FEEDBACK_SUBMIT',
        entityType: 'Feedback',
        entityId: feedback.id,
        eventId: feedback.eventId,
        after: { rating: feedback.rating, category: feedback.category },
      },
    });
    return received;
  });
}

export async function readFeedback(actor: Actor, eventId?: string, page = 1) {
  requirePermission(actor.roleName, 'feedback.view');
  const query = z
    .object({ eventId: z.string().uuid().optional(), page: z.number().int().min(1).max(1000000) })
    .parse({ eventId, page });
  const where = query.eventId ? { eventId: query.eventId } : {};
  const selected = query.eventId
    ? await db.event.findUnique({ where: { id: query.eventId }, select: { status: true } })
    : null;
  if (query.eventId && !selected) throw new AppError(404, 'Event not found.');
  const distributionQuery = db.feedback.groupBy({
    by: ['rating'],
    where,
    _count: { _all: true },
  });
  const [summary, lowRatings, distribution, rows] = await db.$transaction([
    db.feedback.aggregate({
      where,
      _count: true,
      _avg: { rating: true, serviceRating: true, speedRating: true },
    }),
    db.feedback.count({ where: { ...where, rating: { lte: 2 } } }),
    distributionQuery,
    db.feedback.findMany({
      where,
      select: {
        id: true,
        rating: true,
        serviceRating: true,
        speedRating: true,
        category: true,
        message: true,
        customerName: true,
        contact: true,
        createdAt: true,
        event: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
      skip: (query.page - 1) * 20,
    }),
  ]);
  const url = new URL('/feedback', process.env.APP_ORIGIN);
  if (eventId) url.searchParams.set('event', eventId);
  return {
    total: summary._count,
    average: summary._avg,
    lowRatings,
    distribution: distribution.map((row) => ({ rating: row.rating, count: row._count._all })),
    rows: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    page,
    pages: Math.max(1, Math.ceil(summary._count / 20)),
    feedbackUrl: url.toString(),
    acceptingFeedback: !selected || ['OPEN', 'CLOSED'].includes(selected.status),
  };
}

export type FeedbackResults = Awaited<ReturnType<typeof readFeedback>>;
