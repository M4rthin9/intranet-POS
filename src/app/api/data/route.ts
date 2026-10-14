import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';
import { readData } from '@/lib/data';
import { errorResponse } from '@/lib/http';
import { z } from 'zod';
export async function GET(request: NextRequest) {
  try {
    const actor = await authenticate(request.cookies.get('ccida_session')?.value);
    const q = request.nextUrl.searchParams;
    const eventId = q.get('eventId') ? z.string().uuid().parse(q.get('eventId')) : undefined;
    return NextResponse.json(
      await readData(actor, q.get('view') ?? '', eventId, (q.get('search') ?? '').slice(0, 120)),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
