import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BarcodeFormat } from '@zxing/library';
import { decodePrintedCode } from './image-decode';

describe('thermal QR validation reader', () => {
  it('reads the captured 203 dpi symbol whose payload confused the previous finder detector', () => {
    const raster = readFileSync(new URL('./fixtures/qr-203dpi-regression.png', import.meta.url));
    const decoded = decodePrintedCode(
      `data:image/png;base64,${raster.toString('base64')}`,
      BarcodeFormat.QR_CODE,
    );
    expect(createHash('sha256').update(decoded).digest('hex')).toBe(
      '250c28e1b3069966748e6ebd5142f376854923588248531e9e17a05892a62994',
    );
  });
});
