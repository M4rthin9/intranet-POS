import { Prisma } from '@prisma/client';

const unavailableCodes = new Set([
  'P1000',
  'P1001',
  'P1002',
  'P1003',
  'P1008',
  'P1010',
  'P1011',
  'P1017',
  'P2024',
  'P2037',
]);
export function databaseUnavailableCode(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientInitializationError)
    return error.errorCode && unavailableCodes.has(error.errorCode)
      ? error.errorCode
      : 'INITIALIZATION';
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (unavailableCodes.has(error.code)) return error.code;
    if (
      error.code === 'P2010' &&
      ['57P01', '57P03', '08001', '08006'].includes(String(error.meta?.code))
    )
      return String(error.meta?.code);
  }
}
