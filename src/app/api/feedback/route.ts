import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate } from '@/lib/auth';
import { checkOrigin, readJson, errorResponse } from '@/lib/http';
import { readFeedback, submitFeedback } from '@/lib/feedback';

export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    return NextResponse.json(await submitFeedback(await readJson(request)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set('Cache-Control', 'no-store');
    if (response.status === 429) response.headers.set('Retry-After', '60');
    return response;
  }
}

export async function GET(request: NextRequest) {
  try {
    const actor = await authenticate(request.cookies.get('ccida_session')?.value);
    const eventId = request.nextUrl.searchParams.get('eventId') || undefined;
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(1000000)
      .parse(request.nextUrl.searchParams.get('page') ?? 1);
    return NextResponse.json(await readFeedback(actor, eventId, page), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
