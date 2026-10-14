import { z } from 'zod';
import { transaction } from './db';
import { audit, type Actor } from './audit';
import { requirePermission, AppError } from './rbac';
import { bahtToSatang } from './money';
export async function catalogAction(actor: Actor, action: string, input: unknown) {
  if (action === 'category.save') {
    requirePermission(actor.roleName, 'category.manage');
    const data = z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(100),
        active: z.boolean().default(true),
        sortOrder: z.number().int().min(0).max(10000).default(0),
      })
      .parse(input);
    return transaction(async (tx) => {
      const { id, ...fields } = data;
      const before = id ? await tx.category.findUniqueOrThrow({ where: { id } }) : null;
      const value = id
        ? await tx.category.update({ where: { id }, data: fields })
        : await tx.category.create({ data: fields });
      await audit(tx, actor, before ? 'CATEGORY_UPDATE' : 'CATEGORY_CREATE', 'Category', value.id, {
        before,
        after: value,
      });
      return value;
    });
  }
  requirePermission(actor.roleName, 'product.update');
  const data = z
    .object({
      id: z.string().uuid().optional(),
      code: z.string().min(1).max(40),
      name: z.string().min(1).max(120),
      categoryId: z.string().uuid(),
      priceBaht: z.string().transform(bahtToSatang),
      image: z
        .string()
        .max(300)
        .regex(/^\/(?!\/)[a-zA-Z0-9_./-]+$/)
        .nullable()
        .optional(),
      active: z.boolean().default(true),
      sortOrder: z.number().int().min(0).max(10000).default(0),
      trackStock: z.boolean().default(false),
      lowStockThreshold: z.number().int().min(0).max(100000).default(5),
    })
    .parse(input);
  if (action !== 'product.save') throw new AppError(404, 'Unknown catalog operation.');
  return transaction(async (tx) => {
    const { id, priceBaht, ...fields } = data;
    const before = id ? await tx.product.findUniqueOrThrow({ where: { id } }) : null;
    const category = await tx.category.findUniqueOrThrow({ where: { id: fields.categoryId } });
    if (!category.active && fields.active) throw new AppError(409, 'Category is archived.');
    const value = id
      ? await tx.product.update({ where: { id }, data: { ...fields, priceSatang: priceBaht } })
      : await tx.product.create({ data: { ...fields, priceSatang: priceBaht } });
    await audit(
      tx,
      actor,
      !value.active ? 'PRODUCT_ARCHIVE' : before ? 'PRODUCT_UPDATE' : 'PRODUCT_CREATE',
      'Product',
      value.id,
      { before, after: value },
    );
    if (before && before.priceSatang !== value.priceSatang)
      await audit(tx, actor, 'PRICE_CHANGE', 'Product', value.id, {
        before: { priceSatang: before.priceSatang },
        after: { priceSatang: value.priceSatang },
      });
    return value;
  });
}
