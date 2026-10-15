import type { RoleName } from '@prisma/client';

export const viewPaths = {
  dashboard: '/dashboard',
  events: '/events',
  pos: '/pos',
  registrations: '/register',
  payments: '/payments',
  stock: '/stock',
  shifts: '/shifts',
  outstanding: '/outstanding',
  reports: '/reports',
  controls: '/controls',
  audit: '/audit',
  products: '/products',
  users: '/users',
  backups: '/backups',
  settings: '/settings',
  feedback: '/feedback-responses',
} as const;
export type AppView = keyof typeof viewPaths;
export const rolePages: Record<
  RoleName,
  { label: string; home: AppView; views: readonly AppView[] }
> = {
  SUPER_ADMIN: {
    label: 'ผู้ดูแลระบบสูงสุด',
    home: 'dashboard',
    views: Object.keys(viewPaths) as AppView[],
  },
  ADMIN: {
    label: 'ผู้ดูแลระบบ',
    home: 'dashboard',
    views: ['dashboard', 'registrations'],
  },
  CASHIER: { label: 'Cashier POS · เจ้าหน้าที่ขายสินค้า', home: 'pos', views: ['pos'] },
  REGISTRATION_CASHIER: {
    label: 'Cashier Register · เจ้าหน้าที่ลงทะเบียน',
    home: 'registrations',
    views: ['registrations'],
  },
  PAYMENT_CASHIER: { label: 'เจ้าหน้าที่รับชำระเงิน', home: 'payments', views: ['payments'] },
};
export const homePath = (role: RoleName) => viewPaths[rolePages[role].home];
export const canView = (role: RoleName, view: AppView) => rolePages[role].views.includes(view);
export function pathView(screen: string): AppView | undefined {
  return (Object.keys(viewPaths) as AppView[]).find((view) => viewPaths[view] === `/${screen}`);
}
