import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';
import { checkOrigin, errorResponse, readBytes } from '@/lib/http';
import { AppError, requirePermission } from '@/lib/rbac';
import { PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_TYPES } from '@/lib/product-image-limits';
import { uploadProductImage } from '@/lib/product-images';

export async function POST(request: NextRequest) {
  try {
    checkOrigin(request, PRODUCT_IMAGE_MAX_BYTES);
    const actor = await authenticate(request.cookies.get('ccida_session')?.value);
    requirePermission(actor.roleName, 'product.update');
    const contentType = request.headers.get('content-type') ?? '';
    if (!PRODUCT_IMAGE_TYPES.includes(contentType))
      throw new AppError(415, 'Choose a JPG, PNG or WebP image.');
    const bytes = await readBytes(request, PRODUCT_IMAGE_MAX_BYTES);
    return NextResponse.json(await uploadProductImage(actor, bytes, contentType), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
