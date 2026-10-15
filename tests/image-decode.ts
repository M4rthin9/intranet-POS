import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import {
  MultiFormatReader,
  RGBLuminanceSource,
  BinaryBitmap,
  HybridBinarizer,
  DecodeHintType,
  BarcodeFormat,
} from '@zxing/library';

export function decodePrintedCode(dataUrl: string, format?: BarcodeFormat) {
  const image = PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'));
  // Use a full-image QR detector. ZXing can mistake payload patterns for finders
  // on some valid nearest-neighbour 203 dpi rasters; no pure-symbol hint is used.
  if (format === undefined || format === BarcodeFormat.QR_CODE) {
    const qr = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
    if (qr) return qr.data;
  }
  const pixels = new Int32Array(image.width * image.height);
  for (let i = 0; i < pixels.length; i++)
    pixels[i] = (image.data[i * 4] << 16) | (image.data[i * 4 + 1] << 8) | image.data[i * 4 + 2];
  const reader = new MultiFormatReader();
  reader.setHints(format ? new Map([[DecodeHintType.POSSIBLE_FORMATS, [format]]]) : new Map());
  return reader
    .decodeWithState(
      new BinaryBitmap(
        new HybridBinarizer(new RGBLuminanceSource(pixels, image.width, image.height)),
      ),
    )
    .getText();
}
