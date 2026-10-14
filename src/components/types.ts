import type { RoleName, EventStatus, StationType, AccountStatus } from '@prisma/client';
export type UserDto = {
  id: string;
  username: string;
  displayName: string;
  roleName: RoleName;
  active?: boolean;
};
export type EventDto = { id: string; code: string; name: string; status: EventStatus };
export type StationDto = {
  id: string;
  code: string;
  name: string;
  type: StationType;
  active: boolean;
};
export type QrDto = { id: string; token: string; issuedAt: string; revokedAt: string | null };
export type RegistrationDto = {
  id: string;
  number: string;
  customerName: string;
  phone?: string;
  group?: string;
  tableNumber?: string;
  guestCount: number;
  notes?: string;
  account: { id: string; status: AccountStatus; credentials: QrDto[] };
};
export type PrintDto = { number: string; customerName: string; qrImage: string; token?: string };
export type CategoryDto = { id: string; name: string; active: boolean; sortOrder: number };
export type ProductDto = {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  priceSatang: number;
  image?: string;
  active: boolean;
  trackStock: boolean;
  sortOrder: number;
  lowStockThreshold: number;
  category: CategoryDto;
  inventories?: { remainingStock: number }[];
};
export type OrderItemDto = {
  id: string;
  productId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  categoryNameSnapshot: string;
  unitPriceSatang: number;
  quantity: number;
  lineTotalSatang: number;
};
export type OrderDto = {
  id: string;
  number: string;
  totalSatang: number;
  status: string;
  createdAt: string;
  items: OrderItemDto[];
  station: { code: string };
  account?: { registration: { number: string; customerName: string } };
};
export type AccountDto = {
  id: string;
  status: string;
  registrationNumber: string;
  customerName: string;
  orders: OrderDto[];
  payments: {
    id: string;
    number: string;
    status: string;
    amountSatang: number;
    confirmedAt: string | null;
  }[];
  outstandingSatang: number;
};
export type PaymentDto = {
  id: string;
  number: string;
  status: string;
  amountSatang: number;
  qrImage?: string;
  displayName?: string;
  createdAt: string;
  confirmedAt: string | null;
  account?: { registration: { number: string; customerName: string } };
  station?: { code: string };
};
export type ReceiptSnapshot = {
  organization: string;
  event: string;
  eventCode: string;
  number: string;
  registrationNumber: string;
  customerName: string;
  orders: { number: string; station: string; totalSatang: number; items: OrderItemDto[] }[];
  amountSatang: number;
  method: string;
  reference: string;
  confirmedAt: string;
  user: string;
  station: string;
};
export type ReceiptDto = { snapshot: ReceiptSnapshot; copy: boolean; printCount: number };
