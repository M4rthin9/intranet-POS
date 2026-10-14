import { AppError } from './rbac';
import { bahtString } from './money';
export function crc16(value: string) {
  let crc = 0xffff;
  for (const byte of Buffer.from(value, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = (crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
const tlv = (tag: string, value: string) =>
  `${tag}${String(Buffer.byteLength(value)).padStart(2, '0')}${value}`;
export function validateIdentifier(type: string, identifier: string) {
  if (type === 'PHONE' && /^0[689]\d{8}$/.test(identifier)) return;
  if (type === 'TAX_ID' && /^\d{13}$/.test(identifier)) return;
  if (type === 'EWALLET' && /^\d{15}$/.test(identifier)) return;
  throw new AppError(400, 'Invalid PromptPay identifier for the selected type.');
}
export function promptPayPayload(type: string, identifier: string, amountSatang: number) {
  validateIdentifier(type, identifier);
  if (!Number.isSafeInteger(amountSatang) || amountSatang <= 0 || amountSatang > 2147483647)
    throw new AppError(400, 'Invalid payment amount.');
  const target = type === 'PHONE' ? `0066${identifier.slice(1)}` : identifier;
  const account =
    tlv('00', 'A000000677010111') +
    tlv(type === 'PHONE' ? '01' : type === 'TAX_ID' ? '02' : '03', target);
  const data =
    tlv('00', '01') +
    tlv('01', '12') +
    tlv('29', account) +
    tlv('58', 'TH') +
    tlv('53', '764') +
    tlv('54', bahtString(amountSatang)) +
    '6304';
  return data + crc16(data);
}
