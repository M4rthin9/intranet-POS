import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { db } from '../src/lib/db';
import { fixture } from './helpers';
import { hashToken } from '../src/lib/auth';
import { uploadProductImage, readProductImage } from '../src/lib/product-images';
import { PRODUCT_IMAGE_MAX_BYTES } from '../src/lib/product-image-limits';
import { POST } from '../src/app/api/product-images/route';
import { GET } from '../src/app/api/product-images/[hash]/route';
import { checkOrigin } from '../src/lib/http';
import { catalogAction } from '../src/lib/catalog';

afterAll(() => db.$disconnect());
describe('product image uploads', () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    f = await fixture();
  }, 60000);
  it('accepts a full 20 MB photo, stores an optimized image and serves it to a signed-in cashier', async () => {
    const token = randomUUID();
    await db.session.create({
      data: {
        userId: f.actors.SUPER_ADMIN.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const png = await sharp({
      create: { width: 2200, height: 1100, channels: 3, background: '#c38f4b' },
    })
      .png()
      .toBuffer();
    const bytes = Buffer.concat([png, Buffer.alloc(PRODUCT_IMAGE_MAX_BYTES - png.length)]);
    const origin = process.env.APP_ORIGIN!;
    const response = await POST(
      new NextRequest(`${origin}/api/product-images`, {
        method: 'POST',
        headers: {
          origin,
          cookie: `ccida_session=${token}`,
          'content-type': 'image/png',
          'content-length': String(bytes.length),
        },
        body: new Uint8Array(bytes),
      }),
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.image).toMatch(/^\/api\/product-images\/[a-f0-9]{64}$/);
    expect(result.width).toBe(1600);
    expect(result.height).toBe(800);
    const hash = result.image.split('/').at(-1)!;
    const stored = await readProductImage(f.actors.CASHIER, hash);
    expect(stored.length).toBeLessThan(500000);
    expect((await sharp(stored).metadata()).format).toBe('webp');
    const downloaded = await GET(
      new NextRequest(`${origin}${result.image}`, {
        headers: { cookie: `ccida_session=${token}` },
      }),
      { params: Promise.resolve({ hash }) },
    );
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('content-type')).toBe('image/webp');
    expect(downloaded.headers.get('cache-control')).toContain('private');
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(stored);
    const category = await db.category.create({ data: { name: `Image test ${f.tag}` } });
    const product = await catalogAction(f.actors.SUPER_ADMIN, 'product.save', {
      code: f.tag,
      name: 'Photo product',
      categoryId: category.id,
      priceBaht: '35',
      image: result.image,
    });
    expect(product).toMatchObject({ image: result.image });
    expect(await uploadProductImage(f.actors.SUPER_ADMIN, bytes, 'image/png')).toEqual(result);
    expect(await db.systemSetting.count({ where: { key: `product-image:${hash}` } })).toBe(1);
    await expect(
      catalogAction(f.actors.SUPER_ADMIN, 'product.save', {
        code: `${f.tag}-bad`,
        name: 'Missing photo',
        categoryId: category.id,
        priceBaht: '35',
        image: `/api/product-images/${'0'.repeat(64)}`,
      }),
    ).rejects.toThrow('Upload the product image');
  });

  it('rejects oversized, corrupt, mismatched and unsafe files and unauthorized uploads', async () => {
    const actor = f.actors.SUPER_ADMIN;
    await expect(
      uploadProductImage(f.actors.CASHIER, Buffer.from('x'), 'image/png'),
    ).rejects.toThrow('not authorized');
    await expect(
      uploadProductImage(actor, Buffer.alloc(PRODUCT_IMAGE_MAX_BYTES + 1), 'image/png'),
    ).rejects.toThrow('20 MB');
    await expect(uploadProductImage(actor, Buffer.from('<svg/>'), 'image/svg+xml')).rejects.toThrow(
      'JPG, PNG or WebP',
    );
    await expect(
      uploadProductImage(actor, Buffer.from('not an image'), 'image/png'),
    ).rejects.toThrow('Cannot read');
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: 'red' } })
      .png()
      .toBuffer();
    await expect(uploadProductImage(actor, png, 'image/jpeg')).rejects.toThrow('Cannot read');
    await expect(uploadProductImage(actor, png.subarray(0, 40), 'image/png')).rejects.toThrow(
      'Cannot read',
    );
    const origin = process.env.APP_ORIGIN!;
    const headers = { origin, 'content-type': 'image/png' };
    expect(
      (
        await POST(
          new NextRequest(`${origin}/api/product-images`, {
            method: 'POST',
            headers,
            body: new Uint8Array(png),
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await POST(
          new NextRequest(`${origin}/api/product-images`, {
            method: 'POST',
            headers: { ...headers, origin: 'http://untrusted.example' },
            body: new Uint8Array(png),
          }),
        )
      ).status,
    ).toBe(403);
    const token = randomUUID();
    await db.session.create({
      data: {
        userId: actor.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(PRODUCT_IMAGE_MAX_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    const request = new NextRequest(`${origin}/api/product-images`, {
      method: 'POST',
      headers: { ...headers, cookie: `ccida_session=${token}` },
      body: stream,
      duplex: 'half',
    } as ConstructorParameters<typeof NextRequest>[1]);
    expect((await POST(request)).status).toBe(413);
    expect(() =>
      checkOrigin(
        new NextRequest(`${origin}/api/operations`, {
          method: 'POST',
          headers: { origin, 'content-length': '100000' },
        }),
      ),
    ).toThrow('too large');
    await expect(readProductImage(actor, '../bad')).rejects.toThrow('not found');
    await expect(readProductImage(actor, '0'.repeat(64))).rejects.toThrow('not found');
  });
});
