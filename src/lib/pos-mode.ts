import type { RoleName } from '@prisma/client';

export function isPosCashier(role: RoleName) {
  return role === 'CASHIER' || role === 'WALK_IN_CASHIER';
}

export function usesInstantPos(role: RoleName, event?: { paymentMode?: string }) {
  return role === 'WALK_IN_CASHIER' || event?.paymentMode === 'INSTANT';
}
