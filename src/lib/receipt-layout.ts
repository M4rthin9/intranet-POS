import { z } from 'zod';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js/node';
import { RECEIPT_LOGO_MAX_DATA_URL } from './receipt-logo-limits';

export const receiptLayoutSchema = z.object({
  receiptLogo: z
    .string()
    .max(RECEIPT_LOGO_MAX_DATA_URL)
    .regex(/^(?:|data:image\/png;base64,[A-Za-z0-9+/]+={0,2})$/)
    .default(''),
  receiptHeader: z.string().trim().max(500).default(''),
  receiptFooter: z.string().trim().max(300).default('ขอบคุณที่ใช้บริการ'),
  receiptQrValue: z
    .string()
    .trim()
    .max(1000)
    .refine(
      (value) => Buffer.byteLength(value, 'utf8') <= 240,
      'Receipt QR content must fit within 240 UTF-8 bytes for thermal printing.',
    )
    .default(''),
  receiptQrLabel: z.string().trim().max(80).default(''),
});
export const defaultReceiptLayout = receiptLayoutSchema.parse({});
export const receiptLayoutInputSchema = z.object({
  receiptLogo: receiptLayoutSchema.shape.receiptLogo.removeDefault().optional(),
  receiptHeader: receiptLayoutSchema.shape.receiptHeader.removeDefault().optional(),
  receiptFooter: receiptLayoutSchema.shape.receiptFooter.removeDefault().optional(),
  receiptQrValue: receiptLayoutSchema.shape.receiptQrValue.removeDefault().optional(),
  receiptQrLabel: receiptLayoutSchema.shape.receiptQrLabel.removeDefault().optional(),
});
export function receiptLayout(value: unknown) {
  const parsed = receiptLayoutSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultReceiptLayout;
}
export async function receiptPresentation(number: string, settings: unknown) {
  const layout = receiptLayout(settings);
  const barcode = await bwipjs.toBuffer({
    bcid: 'code128',
    text: number,
    scale: 3,
    height: 12,
    includetext: false,
    paddingwidth: 12,
    paddingheight: 2,
    backgroundcolor: 'FFFFFF',
  });
  return {
    logoImage: layout.receiptLogo || null,
    header: layout.receiptHeader,
    footer: layout.receiptFooter,
    qrLabel: layout.receiptQrLabel,
    qrImage: layout.receiptQrValue
      ? await QRCode.toDataURL(layout.receiptQrValue, {
          width: 480,
          errorCorrectionLevel: 'M',
        })
      : null,
    barcodeValue: number,
    barcodeImage: `data:image/png;base64,${barcode.toString('base64')}`,
    barcodeWidth: barcode.readUInt32BE(16),
    barcodeHeight: barcode.readUInt32BE(20),
  };
}
