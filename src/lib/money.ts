import { AppError } from './rbac';
export function bahtToSatang(value: string): number {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value))
    throw new AppError(400, 'Use a positive THB price with at most two decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (amount <= 0 || amount > 1000000)
    throw new AppError(400, 'Price must be between ฿0.01 and ฿10,000.');
  return amount;
}
export function sumMoney(values: number[]): number {
  const total = values.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(total) || total < 0 || total > 2147483647)
    throw new AppError(400, 'Financial total exceeds the supported limit.');
  return total;
}
export const bahtString = (satang: number) =>
  `${Math.floor(satang / 100)}.${String(satang % 100).padStart(2, '0')}`;
