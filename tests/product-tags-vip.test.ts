import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { BarcodeFormat } from '@zxing/library';
import { z } from 'zod';
import sharp from 'sharp';
import { db } from '../src/lib/db';
import { fixture } from './helpers';
import { decodePrintedCode } from './image-decode';
import { productScanValue, productIdFromScan, scannedProduct } from '../src/lib/product-scan';
import { productTags } from '../src/lib/product-tags';
import { catalogAction } from '../src/lib/catalog';
import { registrationAction } from '../src/lib/registration';
import { vipWelcomeCard, exportVipCards } from '../src/lib/vip-cards';
import { vipCardPdf, vipCardsPdf, vipCardImage } from '../src/lib/vip-card-pdf';
import { readData } from '../src/lib/data';
import { orderAction } from '../src/lib/orders';

afterAll(() => db.$disconnect());

describe('product tags and VIP welcome cards', () => {
  it('filters customer types and preserves the account and QR through VIP changes', async () => {
    const f = await fixture();
    const created = z.object({ id: z.string(), token: z.string() }).parse(
      await registrationAction(f.actors.REGISTRATION_CASHIER, 'registration.create', {
        eventId: f.fixtureEvent.id,
        stationId: f.stations[0].id,
        customerName: 'Normal customer',
      }),
    );
    const lookup = () =>
      orderAction(f.actors.CASHIER, 'account.lookup', {
        eventId: f.fixtureEvent.id,
        token: created.token,
      });
    const original = z.object({ id: z.string(), isVip: z.boolean() }).parse(await lookup());
    expect(original.isVip).toBe(false);
    const list = (type: 'all' | 'normal' | 'vip', search = '') =>
      readData(f.actors.REGISTRATION_CASHIER, 'registrations', f.fixtureEvent.id, search, type);
    expect(await list('normal')).toMatchObject([{ id: created.id, isVip: false }]);
    expect(await list('vip')).toEqual([]);
    await registrationAction(f.actors.REGISTRATION_CASHIER, 'registration.update', {
      id: created.id,
      customerName: 'Promoted customer',
      isVip: true,
      reason: 'VIP invitation',
    });
    // Editing an unrelated field must retain the current customer type.
    await registrationAction(f.actors.REGISTRATION_CASHIER, 'registration.update', {
      id: created.id,
      customerName: 'Updated VIP customer',
      reason: 'Correct customer name',
    });
    expect(await lookup()).toMatchObject({ id: original.id, isVip: true });
    expect(await list('normal')).toEqual([]);
    expect(await list('vip', 'Updated')).toMatchObject([{ id: created.id, isVip: true }]);
    expect(await list('vip', 'No match')).toEqual([]);
    await registrationAction(f.actors.REGISTRATION_CASHIER, 'registration.update', {
      id: created.id,
      customerName: 'Normal again',
      isVip: false,
      reason: 'Return to normal',
    });
    expect(await lookup()).toMatchObject({ id: original.id, isVip: false });
    expect(await db.qrCredential.count({ where: { accountId: original.id } })).toBe(1);
    await expect(vipWelcomeCard(f.actors.SUPER_ADMIN, created.id)).rejects.toThrow(
      'Mark this customer as VIP',
    );
  });

  it('round-trips compact product identities and separates customer credentials', () => {
    for (let index = 0; index < 20; index++) {
      const id = randomUUID();
      const scan = productScanValue(id);
      expect(scan).toMatch(/^P:[A-Za-z0-9_-]{22}$/);
      expect(productIdFromScan(scan)).toBe(id);
      expect(scannedProduct([{ id, code: 'TEA-01' }], scan)?.id).toBe(id);
      expect(scannedProduct([{ id, code: 'TEA-01' }], ' TEA-01 ')?.id).toBe(id);
    }
    expect(productIdFromScan('CCA-customer-credential')).toBeNull();
    expect(productIdFromScan('P:invalid')).toBeNull();
    expect(scannedProduct([{ id: randomUUID(), code: 'tea' }], 'TEA')).toBeUndefined();
    expect(() => productScanValue('bad-id')).toThrow();
  });

  it('prints current prices and decodable product-only symbols, enforcing Super Admin access', async () => {
    const f = await fixture();
    const category = await db.category.create({ data: { name: `Tags-${f.tag}` } });
    const product = await db.product.create({
      data: { code: `TAG-${f.tag}`, name: 'ชาไทยเย็น', categoryId: category.id, priceSatang: 4550 },
    });
    const input = { productIds: [product.id], copies: 2 };
    for (const role of ['ADMIN', 'CASHIER', 'PAYMENT_CASHIER', 'REGISTRATION_CASHIER'] as const)
      await expect(productTags(f.actors[role], input)).rejects.toThrow('Only Super Admin');
    const result = await productTags(f.actors.SUPER_ADMIN, input);
    expect(result.tags).toHaveLength(2);
    const tag = result.tags[0];
    expect(tag.priceSatang).toBe(4550);
    expect(decodePrintedCode(tag.qrImage, BarcodeFormat.QR_CODE)).toBe(tag.scanValue);
    expect(decodePrintedCode(tag.barcodeImage, BarcodeFormat.CODE_128)).toBe(tag.scanValue);
    expect(productIdFromScan(tag.scanValue)).toBe(product.id);
    await catalogAction(f.actors.SUPER_ADMIN, 'product.save', { ...product, priceBaht: '50.00' });
    expect((await productTags(f.actors.SUPER_ADMIN, input)).tags[0].priceSatang).toBe(5000);
    await expect(
      productTags(f.actors.SUPER_ADMIN, { productIds: [product.id], copies: 11 }),
    ).rejects.toThrow();
    await db.product.update({ where: { id: product.id }, data: { active: false } });
    await expect(productTags(f.actors.SUPER_ADMIN, input)).rejects.toThrow('archived');
  });

  it('prints VIP PDFs only for authorized, assigned VIP customers using their current credential', async () => {
    const f = await fixture();
    const result = await registrationAction(f.actors.REGISTRATION_CASHIER, 'registration.create', {
      eventId: f.fixtureEvent.id,
      stationId: f.stations[0].id,
      customerName: 'VIP test customer',
    });
    const created = z
      .object({
        id: z.string().uuid(),
        token: z.string(),
        account: z.object({ id: z.string().uuid() }),
      })
      .parse(result);
    expect((await db.registration.findUniqueOrThrow({ where: { id: created.id } })).isVip).toBe(
      false,
    );
    await expect(vipWelcomeCard(f.actors.SUPER_ADMIN, created.id)).rejects.toThrow(
      'Mark this customer as VIP',
    );
    await registrationAction(f.actors.REGISTRATION_CASHIER, 'registration.update', {
      id: created.id,
      customerName: 'VIP test customer',
      isVip: true,
      reason: 'VIP invitation',
    });
    for (const role of ['ADMIN', 'CASHIER', 'PAYMENT_CASHIER'] as const)
      await expect(vipWelcomeCard(f.actors[role], created.id)).rejects.toThrow(
        'VIP cards may be printed',
      );
    const original = await vipWelcomeCard(f.actors.REGISTRATION_CASHIER, created.id);
    expect(original.pdf.subarray(0, 8).toString()).toBe('%PDF-1.4');
    const text = original.pdf.toString('latin1');
    expect(text).toContain('/MediaBox [0 0 243.779528 153.070866]');
    const xref = Number(text.match(/startxref\n(\d+)\n%%EOF/)?.[1]);
    expect(original.pdf.subarray(xref, xref + 4).toString()).toBe('xref');
    expect(await db.qrCredential.count({ where: { accountId: created.account.id } })).toBe(1);
    const normal = (await registrationAction(f.actors.REGISTRATION_CASHIER, 'qr.print', {
      registrationId: created.id,
    })) as { token: string };
    expect(normal.token).toBe(created.token);
    expect(original.pdf.equals(await vipCardPdf(normal.token))).toBe(true);
    const second = z.object({ id: z.string().uuid() }).parse(
      await registrationAction(f.actors.REGISTRATION_CASHIER, 'registration.create', {
        eventId: f.fixtureEvent.id,
        stationId: f.stations[0].id,
        customerName: 'Second VIP',
        isVip: true,
      }),
    );
    const batch = await exportVipCards(f.actors.REGISTRATION_CASHIER, {
      registrationIds: [second.id, created.id],
      format: 'pdf',
      a4: true,
    });
    expect(batch.file.toString('latin1')).toContain('/MediaBox [0 0 595.275591 841.889764]');
    expect(batch.filename).toBe('VIP-A4-2-cards.pdf');
    await expect(
      exportVipCards(f.actors.ADMIN, { registrationIds: [created.id], format: 'png' }),
    ).rejects.toThrow('VIP cards may be printed');
    await expect(
      exportVipCards(f.actors.SUPER_ADMIN, {
        registrationIds: [created.id, second.id],
        format: 'png',
      }),
    ).rejects.toThrow();
    await expect(
      exportVipCards(f.actors.SUPER_ADMIN, { registrationIds: [created.id, created.id], a4: true }),
    ).rejects.toThrow();
    const png = await exportVipCards(f.actors.REGISTRATION_CASHIER, {
      registrationIds: [created.id],
      format: 'png',
    });
    expect(png.contentType).toBe('image/png');
    expect((await sharp(png.file).metadata()).density).toBe(300);
    const updated = (await registrationAction(f.actors.SUPER_ADMIN, 'qr.reissue', {
      registrationId: created.id,
      reason: 'Lost VIP card',
    })) as { token: string };
    expect(
      (await vipWelcomeCard(f.actors.SUPER_ADMIN, created.id)).pdf.equals(
        await vipCardPdf(updated.token),
      ),
    ).toBe(true);
    expect(await db.qrCredential.count({ where: { accountId: created.account.id } })).toBe(2);
    const other = await db.event.create({
      data: { code: `OTHER-${f.tag}`, name: 'Unassigned event' },
    });
    await db.user.update({
      where: { id: f.actors.REGISTRATION_CASHIER.id },
      data: { assignedEventId: other.id },
    });
    await expect(vipWelcomeCard(f.actors.REGISTRATION_CASHIER, created.id)).rejects.toThrow(
      'not assigned',
    );
    await db.customerAccount.update({
      where: { id: created.account.id },
      data: { status: 'BLOCKED' },
    });
    await expect(vipWelcomeCard(f.actors.SUPER_ADMIN, created.id)).rejects.toThrow('available QR');
  });

  it('creates a print preview without registering a production customer', async () => {
    await mkdir('docs/validation', { recursive: true });
    const token = 'CCA-' + 'PREVIEW-NOT-A-REAL-CUSTOMER'.padEnd(43, '0');
    await writeFile('docs/validation/vip-welcome-preview.pdf', await vipCardPdf(token));
    await writeFile(
      'docs/validation/vip-a4-preview.pdf',
      await vipCardsPdf(
        Array.from({ length: 11 }, (_, i) => token.slice(0, -2) + String(i).padStart(2, '0')),
        true,
      ),
    );
    const pdf = await vipCardsPdf(
      Array.from({ length: 11 }, () => token),
      true,
    );
    expect(pdf.toString('latin1')).toContain('/Count 2');
    for (const format of ['png', 'jpg'] as const) {
      const file = await vipCardImage(token, format);
      const info = await sharp(file).metadata();
      expect(info.width).toBe(1016);
      expect(info.height).toBe(638);
      expect(info.density).toBe(300);
      const qr = await sharp(file)
        .extract({ left: 800, top: 340, width: 170, height: 170 })
        .png()
        .toBuffer();
      expect(
        decodePrintedCode(`data:image/png;base64,${qr.toString('base64')}`, BarcodeFormat.QR_CODE),
      ).toBe(token);
      await writeFile(`docs/validation/vip-welcome-preview.${format}`, file);
    }
  });
});
