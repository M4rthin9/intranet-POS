import type { RoleName } from '@prisma/client';
export const rolePermissions: Record<RoleName, readonly string[]> = {
  SUPER_ADMIN: ['*'],
  ADMIN: [
    'dashboard.view',
    'registration.create',
    'registration.view',
    'registration.update',
    'registration.qr.create',
    'registration.qr.reprint',
    'registration.qr.block',
    'registration.qr.reissue',
    'event.view',
    'station.view',
    'shift.manage',
  ],
  REGISTRATION_CASHIER: [
    'registration.create',
    'registration.view',
    'registration.update',
    'registration.qr.create',
    'registration.qr.reprint',
    'registration.qr.block',
    'registration.qr.reissue',
    'event.view',
    'station.view',
    'shift.manage',
  ],
  CASHIER: [
    'product.view',
    'order.create',
    'order.view_own',
    'account.lookup',
    'event.view',
    'station.view',
    'shift.manage',
  ],
  PAYMENT_CASHIER: [
    'payment.view',
    'payment.promptpay.create',
    'payment.promptpay.print',
    'payment.confirm',
    'payment.receipt.print',
    'payment.receipt.reprint',
    'account.lookup',
    'event.view',
    'station.view',
    'shift.manage',
  ],
};
export const permissions = [
  ...new Set([
    ...Object.values(rolePermissions).flat(),
    'product.create',
    'product.update',
    'product.archive',
    'category.manage',
    'order.view',
    'order.void',
    'payment.void',
    'account.reopen',
    'event.manage',
    'station.manage',
    'user.manage',
    'report.view',
    'audit.view',
    'settings.manage',
    'backup.manage',
    'stock.manage',
  ]),
];
export function can(role: RoleName, permission: string) {
  return role === 'SUPER_ADMIN' || rolePermissions[role].includes(permission);
}
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function requirePermission(role: RoleName, permission: string) {
  if (!can(role, permission)) throw new AppError(403, 'You are not authorized for this operation.');
}
