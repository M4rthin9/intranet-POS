import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, isRejectedSubmission } from '../src/components/context';
import { isOrderIntent, isGenerateIntent, isConfirmIntent } from '../src/components/intent-schemas';
import { randomUUID } from 'node:crypto';
import { contentSecurityPolicy } from '../src/lib/security-headers';
afterEach(() => vi.unstubAllGlobals());

describe('financial client retry classification', () => {
  it('allows React development debugging while keeping eval disabled in production', () => {
    expect(contentSecurityPolicy(true)).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy(false)).not.toContain("'unsafe-eval'");
    expect(contentSecurityPolicy(false)).toContain("object-src 'none'");
  });
  it('keeps unknown attempts for network errors, HTML errors and truncated successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Disconnected')));
    await expect(api('/api/operations')).rejects.toMatchObject({ status: 0 });
    for (const status of [200, 404, 502]) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('<html>proxy error', { status })),
      );
      await expect(api('/api/operations')).rejects.toMatchObject({ status: 503 });
    }
    for (const status of [0, 401, 403, 429, 500, 503])
      expect(isRejectedSubmission(new ApiError('uncertain', status))).toBe(false);
    for (const status of [400, 404, 409, 422])
      expect(isRejectedSubmission(new ApiError('rejected by application', status))).toBe(true);
  });
  it('rejects malformed stored intents before the UI can crash or replay different data', () => {
    const context = {
      eventId: randomUUID(),
      stationId: randomUUID(),
      key: randomUUID(),
      token: 'CCA-secure-test-token',
    };
    expect(isGenerateIntent(context)).toBe(true);
    expect(
      isOrderIntent({
        ...context,
        expectedTotalSatang: 4550,
        items: [{ productId: randomUUID(), quantity: 1 }],
      }),
    ).toBe(true);
    expect(isOrderIntent({ ...context, items: 'not-an-array' })).toBe(false);
    expect(isGenerateIntent({ key: 'wrong' })).toBe(false);
    expect(
      isConfirmIntent({
        paymentId: randomUUID(),
        stationId: context.stationId,
        key: context.key,
        reference: 'TEST-reference',
        evidence: 'Test only evidence',
        evidenceVerified: true,
      }),
    ).toBe(true);
    expect(isConfirmIntent({ ...context, evidenceVerified: false })).toBe(false);
  });
});
