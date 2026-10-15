import QRCode from 'qrcode';
import bwipjs from 'bwip-js/node';
import { z } from 'zod';
import { db } from './db';
import { audit, type Actor } from './audit';
import { AppError } from './rbac';
import { productScanValue } from './product-scan';

export async function productTags(actor: Actor, input: unknown) {
  if (actor.roleName !== 'SUPER_ADMIN')
    throw new AppError(403, 'Only Super Admin may print product tags.');
  const data = z
    .object({
      productIds: z.array(z.string().uuid()).min(1).max(60),
      copies: z.number().int().min(1).max(10).default(1),
    })
    .refine(
      (value) => value.productIds.length * value.copies <= 120,
      'Print at most 120 tags at a time.',
    )
    .parse(input);
  const ids = [...new Set(data.productIds)];
  const products = await db.product.findMany({
    where: { id: { in: ids }, active: true, category: { active: true } },
  });
  if (products.length !== ids.length)
    throw new AppError(409, 'A selected product is unavailable or archived.');
  const tags = await Promise.all(
    ids.map(async (id) => {
      const product = products.find((value) => value.id === id)!;
      const scanValue = productScanValue(product.id);
      const barcode = await bwipjs.toBuffer({
        bcid: 'code128',
        text: scanValue,
        scale: 3,
        height: 10,
        includetext: false,
        paddingwidth: 12,
        paddingheight: 2,
        backgroundcolor: 'FFFFFF',
      });
      return {
        id: product.id,
        code: product.code,
        name: product.name,
        priceSatang: product.priceSatang,
        scanValue,
        qrImage: await QRCode.toDataURL(scanValue, {
          width: 384,
          margin: 4,
          errorCorrectionLevel: 'M',
        }),
        barcodeImage: `data:image/png;base64,${barcode.toString('base64')}`,
      };
    }),
  );
  await audit(db, actor, 'PRODUCT_TAG_PRINT', 'Product', ids.join(','), {
    after: {
      products: products.map((product) => ({ id: product.id, priceSatang: product.priceSatang })),
      copies: data.copies,
    },
  });
  return { tags: tags.flatMap((tag) => Array.from({ length: data.copies }, () => tag)) };
}
