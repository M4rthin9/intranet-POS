import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { login, authenticate, hashToken } from '@/lib/auth';
import { transaction } from '@/lib/db';
import { audit } from '@/lib/audit';
import { errorResponse, checkOrigin, readJson } from '@/lib/http';
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const { username, password } = z
      .object({ username: z.string().min(1).max(80), password: z.string().min(1).max(256) })
      .parse(await readJson(request));
    const result = await login(
      username,
      password,
      request.headers.get('x-real-ip') ?? 'local',
      request.headers.get('user-agent') ?? undefined,
    );
    const response = NextResponse.json({ user: result.user });
    response.cookies.set('ccida_session', result.token, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: 'strict',
      expires: result.expiresAt,
      path: '/',
    });
    return response;
  } catch (error) {
    return errorResponse(error, 'login');
  }
}
export async function DELETE(request: NextRequest) {
  try {
    checkOrigin(request);
    const token = request.cookies.get('ccida_session')?.value;
    const actor = await authenticate(token);
    await transaction(async (tx) => {
      await tx.session.deleteMany({ where: { tokenHash: hashToken(token!) } });
      await audit(tx, actor, 'LOGOUT', 'User', actor.id);
    });
    const response = NextResponse.json({ ok: true });
    response.cookies.delete('ccida_session');
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(await authenticate(request.cookies.get('ccida_session')?.value), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
