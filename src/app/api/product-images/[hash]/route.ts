import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';
import { errorResponse } from '@/lib/http';
import { readProductImage } from '@/lib/product-images';

export async function GET(request: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  try {
    const actor = await authenticate(request.cookies.get('ccida_session')?.value);
    const bytes = await readProductImage(actor, (await params).hash);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
