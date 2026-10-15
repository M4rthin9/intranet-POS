import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';
import { dashboard } from '@/lib/reports';
import { errorResponse } from '@/lib/http';

export async function GET(request: NextRequest) {
  try {
    const actor = await authenticate(request.cookies.get('ccida_session')?.value);
    return NextResponse.json(
      await dashboard(actor, request.nextUrl.searchParams.get('eventId') ?? ''),
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
