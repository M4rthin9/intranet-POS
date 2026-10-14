'use client';
import { createContext, useContext } from 'react';
import type { UserDto, EventDto, StationDto, PrintDto } from './types';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', ...options });
  } catch {
    throw new ApiError(
      'เซิร์ฟเวอร์ไม่พร้อมใช้งาน กรุณาเก็บรายการเดิมและลองใหม่ / Server unavailable.',
      0,
    );
  }
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error ?? 'Operation failed.', response.status);
  return data as T;
}
export type AppContextValue = {
  user: UserDto;
  events: EventDto[];
  stations: StationDto[];
  eventId: string;
  stationId: string;
  busy: boolean;
  revision: number;
  op: <T>(action: string, input: unknown) => Promise<T>;
  notify: (message: string) => void;
  print: (value: PrintDto) => void;
};
export const AppContext = createContext<AppContextValue | null>(null);
export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('Missing application context');
  return context;
}
export const money = (satang: number) =>
  new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(satang / 100);
export const time = (value: string) =>
  new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
