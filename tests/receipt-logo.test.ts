import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { validateReceiptLogo } from '../src/lib/receipt-logo';
import { receiptLayoutInputSchema } from '../src/lib/receipt-layout';

describe('receipt logo upload validation', () => {
  it('accepts a decoded local PNG and clearing the logo', async () => {
    const png = await sharp({
      create: { width: 180, height: 80, channels: 4, background: '#000000' },
    })
      .png()
      .toBuffer();
    const logo = `data:image/png;base64,${png.toString('base64')}`;
    expect(receiptLayoutInputSchema.parse({ receiptLogo: logo }).receiptLogo).toBe(logo);
    await expect(validateReceiptLogo(logo)).resolves.toBeUndefined();
    await expect(validateReceiptLogo('')).resolves.toBeUndefined();
  });
  it('rejects remote/SVG content, corrupt images, oversized pixels and encoded uploads', async () => {
    for (const receiptLogo of [
      'https://example.test/logo.png',
      'data:image/svg+xml;base64,PHN2Zz4=',
      `data:image/png;base64,${'A'.repeat(50000)}`,
    ])
      expect(receiptLayoutInputSchema.safeParse({ receiptLogo }).success).toBe(false);
    await expect(validateReceiptLogo('data:image/png;base64,AAAA')).rejects.toThrow(
      'Invalid receipt logo',
    );
    const large = await sharp({
      create: { width: 512, height: 256, channels: 4, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    await expect(
      validateReceiptLogo(`data:image/png;base64,${large.toString('base64')}`),
    ).rejects.toThrow('Invalid receipt logo');
    const valid = await sharp({
      create: { width: 100, height: 50, channels: 4, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    await expect(
      validateReceiptLogo(`data:image/png;base64,${valid.subarray(0, 40).toString('base64')}`),
    ).rejects.toThrow('Invalid receipt logo');
  });
});
