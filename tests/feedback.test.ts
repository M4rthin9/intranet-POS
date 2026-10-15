import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { db } from '../src/lib/db';
import { fixture } from './helpers';
import { feedbackFormData, readFeedback, submitFeedback } from '../src/lib/feedback';
import { GET, POST } from '../src/app/api/feedback/route';
import { canView } from '../src/lib/role-pages';

afterAll(() => db.$disconnect());
const input = (extra: Record<string, unknown> = {}) => ({ key: randomUUID(), rating: 5, ...extra });

describe('customer feedback', () => {
  it('stores anonymous ratings with optional event/contact and a redacted audit record', async () => {
    const data = input({
      message: '  A helpful service  ',
      customerName: '  Guest  ',
      contact: ' guest@example.test ',
    });
    expect(await submitFeedback(data)).toEqual({ received: true });
    const saved = await db.feedback.findUniqueOrThrow({ where: { submissionKey: data.key } });
    expect(saved.eventId).toBeNull();
    expect(saved.message).toBe('A helpful service');
    expect(saved.customerName).toBe('Guest');
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: saved.id, action: 'FEEDBACK_SUBMIT' },
    });
    expect(audit.actorRole).toBe('PUBLIC');
    expect(audit.after).toEqual({ rating: 5, category: 'SUGGESTION' });
    expect(JSON.stringify(audit)).not.toContain('guest@example.test');
    expect(JSON.stringify(audit)).not.toContain('A helpful service');
    const anonymous = input();
    await submitFeedback(anonymous);
    expect(
      await db.feedback.findUniqueOrThrow({ where: { submissionKey: anonymous.key } }),
    ).toMatchObject({ customerName: null, contact: null, message: '' });
  });

  it('deduplicates concurrent retries and rejects a changed payload using the same request key', async () => {
    const data = input({ message: 'A retry-safe response', serviceRating: 4, speedRating: 3 });
    const result = await Promise.all([
      submitFeedback(data),
      submitFeedback(data),
      submitFeedback(data),
    ]);
    expect(result).toEqual([{ received: true }, { received: true }, { received: true }]);
    expect(await db.feedback.count({ where: { submissionKey: data.key } })).toBe(1);
    const saved = await db.feedback.findUniqueOrThrow({ where: { submissionKey: data.key } });
    expect(
      await db.auditLog.count({ where: { entityId: saved.id, action: 'FEEDBACK_SUBMIT' } }),
    ).toBe(1);
    await expect(submitFeedback({ ...data, rating: 1 })).rejects.toMatchObject({ status: 409 });
    expect((await db.feedback.findUniqueOrThrow({ where: { id: saved.id } })).rating).toBe(5);
  });

  it('accepts open/closed events, hides drafts/archives and rejects invalid event links and stale submissions', async () => {
    const f = await fixture();
    const hidden = await db.event.create({
      data: { code: `PRIVATE-${f.tag}`, name: 'Private draft' },
    });
    const data = await feedbackFormData(f.fixtureEvent.id);
    expect(data.selectedEventId).toBe(f.fixtureEvent.id);
    expect(data.events.map((event) => event.id)).not.toContain(hidden.id);
    expect(Object.keys(data.events[0]).sort()).toEqual(['code', 'id', 'name']);
    await expect(feedbackFormData('invalid')).rejects.toMatchObject({ status: 404 });
    await expect(feedbackFormData(hidden.id)).rejects.toMatchObject({ status: 404 });
    await expect(submitFeedback(input({ eventId: hidden.id }))).rejects.toMatchObject({
      status: 404,
    });
    await db.event.update({ where: { id: f.fixtureEvent.id }, data: { status: 'CLOSED' } });
    await submitFeedback(input({ eventId: f.fixtureEvent.id }));
    await db.event.update({ where: { id: f.fixtureEvent.id }, data: { status: 'ARCHIVED' } });
    expect((await readFeedback(f.actors.SUPER_ADMIN, f.fixtureEvent.id)).acceptingFeedback).toBe(
      false,
    );
    await expect(submitFeedback(input({ eventId: f.fixtureEvent.id }))).rejects.toMatchObject({
      status: 404,
    });
  });

  it('validates scores, lengths and the bot field before insertion, with a database score constraint', async () => {
    for (const fields of [
      { rating: 0 },
      { rating: 6 },
      { rating: 2.5 },
      { serviceRating: 0 },
      { speedRating: 6 },
      { message: 'x'.repeat(2001) },
      { contact: 'x'.repeat(201) },
      { category: 'UNKNOWN' },
      { website: 'bot.example' },
    ]) {
      const data = input(fields);
      await expect(submitFeedback(data)).rejects.toThrow();
      expect(await db.feedback.count({ where: { submissionKey: data.key } })).toBe(0);
    }
    await expect(
      db.feedback.create({
        data: { submissionKey: randomUUID(), requestHash: 'a'.repeat(64), rating: 6, message: '' },
      }),
    ).rejects.toThrow();
  });

  it('restricts detailed feedback and summaries to Super Admin and scopes counts to the selected event', async () => {
    const f = await fixture();
    await submitFeedback(
      input({ eventId: f.fixtureEvent.id, serviceRating: 4, category: 'COMPLIMENT' }),
    );
    await submitFeedback(
      input({
        eventId: f.fixtureEvent.id,
        rating: 1,
        speedRating: 2,
        message: '<script>alert(1)</script>',
      }),
    );
    const results = await readFeedback(f.actors.SUPER_ADMIN, f.fixtureEvent.id);
    expect(results).toMatchObject({
      total: 2,
      lowRatings: 1,
      page: 1,
      pages: 1,
      average: { rating: 3, serviceRating: 4, speedRating: 2 },
    });
    expect(results.rows).toHaveLength(2);
    expect(results.rows[0]).not.toHaveProperty('submissionKey');
    expect(results.rows[0]).not.toHaveProperty('requestHash');
    expect(new URL(results.feedbackUrl).searchParams.get('event')).toBe(f.fixtureEvent.id);
    for (const role of ['ADMIN', 'CASHIER', 'REGISTRATION_CASHIER', 'PAYMENT_CASHIER'] as const) {
      await expect(readFeedback(f.actors[role])).rejects.toMatchObject({ status: 403 });
      expect(canView(role, 'feedback')).toBe(false);
    }
    await expect(readFeedback(f.actors.SUPER_ADMIN, undefined, 0)).rejects.toThrow();
    expect((await readFeedback(f.actors.SUPER_ADMIN, f.fixtureEvent.id, 2)).rows).toEqual([]);
  });

  it('supports public same-origin POST without exposing the review endpoint or accepting cross-origin requests', async () => {
    const origin = process.env.APP_ORIGIN!;
    const request = (body: unknown, from = origin) =>
      new NextRequest(`${origin}/api/feedback`, {
        method: 'POST',
        headers: { Origin: from, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const response = await POST(request(input()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await GET(new NextRequest(`${origin}/api/feedback`))).status).toBe(401);
    expect((await POST(request(input(), 'https://wrong-origin.example'))).status).toBe(403);
    expect((await POST(request({ key: randomUUID() }))).status).toBe(400);
    expect((await POST(request({ message: 'x'.repeat(70000) }))).status).toBe(413);
  });

  it('throttles new writes but still acknowledges an already saved request during rate limiting', async () => {
    const key = 'feedback:submit:minute';
    const saved = input();
    await submitFeedback(saved);
    const original = await db.rateLimit.findUnique({ where: { key } });
    try {
      await db.rateLimit.upsert({
        where: { key },
        create: { key, count: 120 },
        update: { count: 120, windowStart: new Date() },
      });
      const data = input();
      await expect(submitFeedback(data)).rejects.toMatchObject({ status: 429 });
      expect(await db.feedback.count({ where: { submissionKey: data.key } })).toBe(0);
      expect(await submitFeedback(saved)).toEqual({ received: true });
    } finally {
      if (original)
        await db.rateLimit.update({
          where: { key },
          data: { count: original.count, windowStart: original.windowStart },
        });
      else await db.rateLimit.delete({ where: { key } });
    }
  });
});
