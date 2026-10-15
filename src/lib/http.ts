import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from './rbac';
import { databaseUnavailableCode } from './database-errors';
export function checkOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!process.env.APP_ORIGIN)
    throw new AppError(503, 'APP_ORIGIN must be configured by the administrator.');
  if (origin !== process.env.APP_ORIGIN) throw new AppError(403, 'Invalid request origin.');
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 65536) throw new AppError(413, 'Request is too large.');
}
export async function readJson(request: NextRequest): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new AppError(415, 'Use application/json.');
  if (!request.body) throw new AppError(400, 'Request body is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 65536) {
        await reader.cancel();
        throw new AppError(413, 'Request is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function errorResponse(error: unknown, context?: 'login') {
  if (error instanceof AppError)
    return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        error: 'Invalid input.',
        fields: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400 },
    );
  const databaseCode = databaseUnavailableCode(error);
  if (databaseCode) {
    console.error('Database unavailable:', { code: databaseCode, context: context ?? 'request' });
    return NextResponse.json(
      {
        error:
          context === 'login'
            ? 'ฐานข้อมูลยังไม่พร้อมใช้งาน กรุณารอสักครู่แล้วลองเข้าสู่ระบบอีกครั้ง / Database unavailable. Retry sign-in when the database is ready.'
            : 'Server unavailable. Keep the current request and retry safely.',
        code: 'DATABASE_UNAVAILABLE',
      },
      { status: 503, headers: { 'Retry-After': '5', 'Cache-Control': 'no-store' } },
    );
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ['P2002', 'P2003', 'P2025'].includes(error.code)
  )
    return NextResponse.json(
      { error: 'Record conflict or record not found. Refresh and try again.' },
      { status: 409 },
    );
  if (error instanceof SyntaxError)
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  console.error('Request failed:', error instanceof Error ? error.name : 'UnknownError');
  return NextResponse.json(
    { error: 'Server unavailable. Keep the current request and retry safely.' },
    { status: 503 },
  );
}
