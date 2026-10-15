import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticate } from '@/lib/auth';
import { checkOrigin, errorResponse, readJson } from '@/lib/http';
import { exportVipCards } from '@/lib/vip-cards';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const user = await authenticate(request.cookies.get('ccida_session')?.value);
    const input = z
      .object({
        registrationId: z.string().uuid().optional(),
        registrationIds: z.array(z.string().uuid()).min(1).max(100).optional(),
        format: z.enum(['pdf', 'png', 'jpg']).optional(),
        a4: z.boolean().optional(),
      })
      .refine(
        (value) => !!value.registrationId !== !!value.registrationIds,
        'Provide one registration or a selection.',
      )
      .parse(await readJson(request));
    const result = await exportVipCards(
      {
        ...user,
        ipAddress: request.headers.get('x-real-ip') ?? undefined,
        userAgent: request.headers.get('user-agent') ?? undefined,
      },
      { ...input, registrationIds: input.registrationIds ?? [input.registrationId!] },
    );
    return new Response(new Uint8Array(result.file), {
      headers: {
        'Content-Type': result.contentType,
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
