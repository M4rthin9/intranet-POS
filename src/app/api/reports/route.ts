import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';
import { report } from '@/lib/reports';
import { errorResponse } from '@/lib/http';
export async function GET(request: NextRequest) {
  try {
    const actor = await authenticate(request.cookies.get('ccida_session')?.value);
    const q = request.nextUrl.searchParams;
    return NextResponse.json(
      await report(
        actor,
        q.get('eventId') ?? '',
        q.get('from') ?? undefined,
        q.get('to') ?? undefined,
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
