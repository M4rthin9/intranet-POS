// Carry only references. Prices and payment status always come from the database.
const slipQr =
  /^CCS:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(CCA-[A-Za-z0-9_-]{43})$/i;

export function orderSlipQr(orderId: string, token: string) {
  const value = `CCS:${orderId}:${token}`;
  if (!slipQr.test(value)) throw new Error('Invalid purchase slip QR references.');
  return value;
}

export function parseOrderSlipQr(value: string) {
  const match = slipQr.exec(value);
  return match ? { orderId: match[1], token: match[2] } : null;
}
