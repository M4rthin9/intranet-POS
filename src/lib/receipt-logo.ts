import sharp from 'sharp';
import { AppError } from './rbac';
import {
  RECEIPT_LOGO_MAX_BYTES,
  RECEIPT_LOGO_MAX_WIDTH,
  RECEIPT_LOGO_MAX_HEIGHT,
} from './receipt-logo-limits';

export async function validateReceiptLogo(value: string) {
  if (!value) return;
  try {
    const encoded = value.slice('data:image/png;base64,'.length);
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length > RECEIPT_LOGO_MAX_BYTES || bytes.toString('base64') !== encoded)
      throw new Error('Invalid encoding');
    const image = sharp(bytes, {
      limitInputPixels: RECEIPT_LOGO_MAX_WIDTH * RECEIPT_LOGO_MAX_HEIGHT,
      failOn: 'warning',
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== 'png' ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > RECEIPT_LOGO_MAX_WIDTH ||
      metadata.height > RECEIPT_LOGO_MAX_HEIGHT ||
      (metadata.pages ?? 1) > 1
    )
      throw new Error('Invalid dimensions');
    // Decode all pixels, so a corrupt upload cannot disable receipt printing later.
    await image.raw().toBuffer();
  } catch {
    throw new AppError(
      400,
      'Invalid receipt logo. Use a valid PNG up to 384 × 256 pixels and 32 KB.',
    );
  }
}
