import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { authenticate } from '@/lib/auth';
import { db } from '@/lib/db';
import { requirePermission, AppError } from '@/lib/rbac';
import { createBackup, listBackups, ensureBackupFile } from '@/lib/backup';
import { checkOrigin, errorResponse, readJson } from '@/lib/http';
export const maxDuration = 600;
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const actor = await authenticate(request.cookies.get('ccida_session')?.value);
    const data = z
      .object({ reason: z.string().trim().min(3).max(500) })
      .parse(await readJson(request));
    return NextResponse.json(await createBackup(actor, data.reason), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function GET(request: NextRequest) {
  try {
    const actor = await authenticate(request.cookies.get('ccida_session')?.value);
    requirePermission(actor.roleName, 'backup.manage');
    const id = request.nextUrl.searchParams.get('id');
    if (!id)
      return NextResponse.json(await listBackups(actor), {
        headers: { 'Cache-Control': 'no-store' },
      });
    z.string().uuid().parse(id);
    const row = await db.systemSetting.findUnique({ where: { key: `backup:${id}` } });
    if (!row) throw new AppError(404, 'Backup not found.');
    const metadata = row.value as { name: string; sha256?: string; storage?: string };
    const path = await ensureBackupFile(metadata);
    const info = await stat(path);
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${metadata.name}"`,
        'Cache-Control': 'no-store',
        'Content-Length': String(info.size),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
