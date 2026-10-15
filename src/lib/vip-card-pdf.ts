import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import sharp from 'sharp';
import QRCode from 'qrcode';

export const VIP_CARD_MM = { width: 86, height: 54 } as const;
const pt = (mm: number) => (mm * 72) / 25.4;
const n = (value: number) => value.toFixed(6);
let artwork: Promise<{ data: Buffer; width: number; height: number }> | undefined;

function template() {
  artwork ??= sharp(join(process.cwd(), 'public/vip-welcome-template.png'))
    .flatten({ background: '#101010' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => ({
      data: deflateSync(data),
      width: info.width,
      height: info.height,
    }));
  return artwork;
}

function cardCommands(token: string, image: { width: number; height: number }) {
  const width = pt(VIP_CARD_MM.width),
    height = pt(VIP_CARD_MM.height);
  const imageHeight = (width * image.height) / image.width;
  const imageY = (height - imageHeight) / 2;
  // Coordinates refer to the supplied 1619 × 971 artwork, inside its white QR frame.
  const scale = width / 1619;
  const qrLeft = 1284 * scale,
    qrTop = height - imageY - 550 * scale,
    qrSize = 242 * scale;
  const qr = QRCode.create(token, { errorCorrectionLevel: 'M' }).modules;
  const moduleSize = qrSize / (qr.size + 8);
  const commands = [
    `0.063 0.063 0.063 rg 0 0 ${n(width)} ${n(height)} re f`,
    `q ${n(width)} 0 0 ${n(imageHeight)} 0 ${n(imageY)} cm /Artwork Do Q`,
    `1 1 1 rg ${n(qrLeft)} ${n(qrTop - qrSize)} ${n(qrSize)} ${n(qrSize)} re f`,
    '0 0 0 rg',
  ];
  for (let row = 0; row < qr.size; row++)
    for (let column = 0; column < qr.size; column++) {
      if (qr.data[row * qr.size + column])
        commands.push(
          `${n(qrLeft + (column + 4) * moduleSize)} ${n(qrTop - (row + 5) * moduleSize)} ${n(moduleSize)} ${n(moduleSize)} re f`,
        );
    }
  return commands.join('\n');
}

/** Exact-size cards, with one shared lossless background and vector QR modules. */
export async function vipCardsPdf(tokens: readonly string[], a4 = false): Promise<Buffer> {
  if (!tokens.length || tokens.length > 100 || (!a4 && tokens.length !== 1))
    throw new Error('Select 1–100 cards for A4, or one individual card.');
  const image = await template();
  const width = pt(a4 ? 210 : 86),
    height = pt(a4 ? 297 : 54);
  const perPage = a4 ? 10 : 1;
  const pages = Array.from({ length: Math.ceil(tokens.length / perPage) }, (_, page) => {
    const commands = tokens.slice(page * perPage, (page + 1) * perPage).map((token, index) => {
      const x = a4 ? pt(17.5 + (index % 2) * 89) : 0;
      const y = a4 ? height - pt(7.5 + Math.floor(index / 2) * 57 + 54) : 0;
      return `q 1 0 0 1 ${n(x)} ${n(y)} cm\n${cardCommands(token, image)}\nQ`;
    });
    if (a4) {
      // Small corner crop marks stay outside every card, including on partial pages.
      commands.push('0.65 G 0.25 w');
      for (let index = 0; index < Math.min(perPage, tokens.length - page * perPage); index++) {
        const left = pt(17.5 + (index % 2) * 89);
        const bottom = height - pt(7.5 + Math.floor(index / 2) * 57 + 54);
        for (const x of [left, left + pt(86)])
          for (const y of [bottom, bottom + pt(54)]) {
            const dx = x === left ? -1 : 1,
              dy = y === bottom ? -1 : 1;
            commands.push(`${n(x + dx * pt(0.4))} ${n(y)} m ${n(x + dx * pt(1.2))} ${n(y)} l S`);
            commands.push(`${n(x)} ${n(y + dy * pt(0.4))} m ${n(x)} ${n(y + dy * pt(1.2))} l S`);
          }
      }
    }
    return Buffer.from(commands.join('\n'), 'ascii');
  });
  const stream = (dictionary: string, data: Buffer) =>
    Buffer.concat([
      Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`, 'ascii'),
      data,
      Buffer.from('\nendstream'),
    ]);
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from(
      `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    ),
    stream(
      `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`,
      image.data,
    ),
    ...pages.flatMap((content) => [
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(width)} ${n(height)}] /Resources << /XObject << /Artwork 3 0 R >> >> /Contents ${5 + pages.indexOf(content) * 2} 0 R >>`,
      ),
      stream('', content),
    ]),
  ];
  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from('\nendobj\n'),
    ]);
    chunks.push(chunk);
    length += chunk.length;
  });
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
        offsets
          .slice(1)
          .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
          .join('') +
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}

export const vipCardPdf = (token: string) => vipCardsPdf([token]);

/** 300 DPI export; QR is rasterized directly at final size without resampling. */
export async function vipCardImage(token: string, format: 'png' | 'jpg') {
  const width = Math.round((86 / 25.4) * 300),
    height = Math.round((54 / 25.4) * 300);
  const source = join(process.cwd(), 'public/vip-welcome-template.png');
  const metadata = await sharp(source).metadata();
  const imageHeight = Math.round((width * metadata.height!) / metadata.width!);
  const top = Math.floor((height - imageHeight) / 2);
  const qrSize = Math.round((242 * width) / 1619);
  const background = await sharp(source).resize(width, imageHeight).removeAlpha().toBuffer();
  const qr = await QRCode.toBuffer(token, { width: qrSize, margin: 4, errorCorrectionLevel: 'M' });
  const card = sharp({ create: { width, height, channels: 3, background: '#101010' } })
    .composite([
      { input: background, left: 0, top },
      {
        input: qr,
        left: Math.round((1284 * width) / 1619),
        top: top + Math.round((550 * width) / 1619),
      },
    ])
    .withMetadata({ density: 300 });
  return format === 'png'
    ? card.png().toBuffer()
    : card.jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer();
}
