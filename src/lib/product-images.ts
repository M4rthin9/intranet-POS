import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { transaction, db } from './db';
import { audit, type Actor } from './audit';
import { AppError, requirePermission } from './rbac';
import { PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_TYPES } from './product-image-limits';

export async function uploadProductImage(actor: Actor, bytes: Buffer, contentType: string) {
  requirePermission(actor.roleName, 'product.update');
  if (!bytes.length || bytes.length > PRODUCT_IMAGE_MAX_BYTES)
    throw new AppError(413, 'Choose an image up to 20 MB.');
  if (!PRODUCT_IMAGE_TYPES.includes(contentType))
    throw new AppError(415, 'Choose a JPG, PNG or WebP image.');
  let image;
  try {
    const source = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' });
    const meta = await source.metadata();
    const formats: Record<string, string> = {
      'image/jpeg': 'jpeg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    if (meta.format !== formats[contentType] || (meta.pages ?? 1) !== 1)
      throw new Error('Unsupported image');
    image = await source
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new AppError(
      400,
      'Cannot read this image. Choose a valid JPG, PNG or WebP photo (up to 40 megapixels).',
    );
  }
  const hash = createHash('sha256').update(image.data).digest('hex');
  const value = {
    base64: image.data.toString('base64'),
    width: image.info.width,
    height: image.info.height,
  };
  await transaction(async (tx) => {
    // Database storage keeps uploaded photos in the existing backup/restore lifecycle.
    await tx.systemSetting.upsert({
      where: { key: `product-image:${hash}` },
      create: { key: `product-image:${hash}`, value },
      update: {},
    });
    await audit(tx, actor, 'PRODUCT_IMAGE_UPLOAD', 'ProductImage', hash, {
      after: {
        originalBytes: bytes.length,
        storedBytes: image.data.length,
        width: value.width,
        height: value.height,
      },
    });
  });
  return { image: `/api/product-images/${hash}`, width: value.width, height: value.height };
}

export async function readProductImage(actor: Actor, hash: string) {
  requirePermission(actor.roleName, 'product.view');
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new AppError(404, 'Product image not found.');
  const row = await db.systemSetting.findUnique({ where: { key: `product-image:${hash}` } });
  const value = row?.value as { base64?: string } | undefined;
  if (!value?.base64) throw new AppError(404, 'Product image not found.');
  return Buffer.from(value.base64, 'base64');
}
