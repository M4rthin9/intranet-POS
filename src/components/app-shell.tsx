'use client';
import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import {
  LayoutDashboard,
  Users,
  ShoppingCart,
  CreditCard,
  CalendarDays,
  Settings,
  LogOut,
  ShieldCheck,
  MapPin,
} from 'lucide-react';
import { AppContext, api, ApiError } from './context';
import type { UserDto, EventDto, StationDto, PrintDto } from './types';
import { RegistrationScreen } from './registration-screen';
import { ManagementScreen } from './management-screen';
import { PosScreen } from './pos-screen';
import { CatalogScreen } from './catalog-screen';
import { ShiftBar } from './shift-bar';
import { PaymentScreen } from './payment-screen';
import { PromptPaySettings } from './promptpay-settings';
import { ControlsScreen } from './controls-screen';
import { DashboardScreen, ReportsScreen } from './dashboard-screen';
import { OutstandingScreen } from './outstanding-screen';
import { ShiftsScreen, StockScreen, ClosingScreen } from './operations-screen';
import { BackupScreen } from './backup-screen';
const roleLabels = {
  SUPER_ADMIN: 'ผู้ดูแลระบบสูงสุด',
  ADMIN: 'เจ้าหน้าที่ลงทะเบียน',
  CASHIER: 'เจ้าหน้าที่ขายสินค้า',
  PAYMENT_CASHIER: 'เจ้าหน้าที่รับชำระเงิน',
};
export function AppShell() {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<EventDto[]>([]);
  const [stations, setStations] = useState<StationDto[]>([]);
  const [eventId, setEventId] = useState('');
  const [stationId, setStationId] = useState('');
  const [view, setView] = useState('dashboard');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [printData, setPrintData] = useState<PrintDto | null>(null);
  const notify = useCallback((text: string) => setMessage(text), []);
  const refresh = useCallback(async () => {
    const [e, s] = await Promise.all([
      api<EventDto[]>('/api/data?view=events'),
      api<StationDto[]>('/api/data?view=stations'),
    ]);
    setEvents(e);
    setStations(s);
    const savedEvent = user ? sessionStorage.getItem(`ccida:event:${user.id}`) : null;
    const savedStation = user ? sessionStorage.getItem(`ccida:station:${user.id}`) : null;
    setEventId(
      (old) =>
        old ||
        (e.some((x) => x.id === savedEvent) ? savedEvent : '') ||
        e.find((x) => x.status === 'OPEN')?.id ||
        e[0]?.id ||
        '',
    );
    setStationId(
      (old) => old || (s.some((x) => x.id === savedStation && x.active) ? savedStation : '') || '',
    );
  }, [user]);
  useEffect(() => {
    api<UserDto>('/api/auth')
      .then((u) => {
        setUser(u);
        setView(
          u.roleName === 'ADMIN'
            ? 'registrations'
            : u.roleName === 'CASHIER'
              ? 'pos'
              : u.roleName === 'PAYMENT_CASHIER'
                ? 'payments'
                : 'dashboard',
        );
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (user)
      Promise.resolve()
        .then(refresh)
        .catch((e) => notify(e.message));
  }, [user, revision, refresh, notify]);
  async function op<T>(action: string, input: unknown): Promise<T> {
    setBusy(true);
    setMessage('');
    try {
      const result = await api<T>('/api/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, input }),
      });
      setRevision((r) => r + 1);
      setMessage('บันทึกสำเร็จ');
      return result;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setUser(null);
      notify(e instanceof Error ? e.message : 'Operation failed');
      throw e;
    } finally {
      setBusy(false);
    }
  }
  const print = useCallback((value: PrintDto) => setPrintData(value), []);
  const nav =
    user?.roleName === 'SUPER_ADMIN'
      ? [
          ['dashboard', 'ภาพรวม', LayoutDashboard],
          ['pos', 'ขายสินค้า', ShoppingCart],
          ['payments', 'รับชำระเงิน', CreditCard],
          ['registrations', 'ลงทะเบียน', Users],
          ['stock', 'สต็อก', ShoppingCart],
          ['shifts', 'กะปฏิบัติงาน', CalendarDays],
          ['closing', 'ปิดกิจกรรม', CalendarDays],
          ['outstanding', 'ยอดค้างชำระ', CreditCard],
          ['reports', 'รายงาน', LayoutDashboard],
          ['controls', 'ควบคุม / VOID', ShieldCheck],
          ['audit', 'บันทึกตรวจสอบ', ShieldCheck],
          ['products', 'สินค้า', ShoppingCart],
          ['events', 'กิจกรรม', CalendarDays],
          ['users', 'ผู้ใช้งาน', ShieldCheck],
          ['stations', 'จุดบริการ', MapPin],
          ['backups', 'สำรองข้อมูล', ShieldCheck],
          ['settings', 'ตั้งค่า', Settings],
        ]
      : user?.roleName === 'ADMIN'
        ? [
            ['registrations', 'ลงทะเบียน', Users],
            ['shifts', 'กะปฏิบัติงาน', CalendarDays],
          ]
        : user?.roleName === 'CASHIER'
          ? [
              ['pos', 'ขายสินค้า', ShoppingCart],
              ['shifts', 'กะปฏิบัติงาน', CalendarDays],
            ]
          : [
              ['payments', 'รับชำระเงิน', CreditCard],
              ['shifts', 'กะปฏิบัติงาน', CalendarDays],
            ];
  if (loading) return <div className="welcome">กำลังเชื่อมต่อ...</div>;
  if (!user)
    return (
      <main className="login">
        <div className="login-brand">
          <div className="brand-mark">C</div>
          <span className="eyebrow">CCIDA · EVENT OPERATIONS</span>
          <h1>
            ทุกจุดขาย
            <br />
            เชื่อมเป็นระบบเดียว
          </h1>
          <p>ซื้อหลายครั้ง · QR เดียว · ชำระก่อนออก</p>
          <div className="login-note">
            <ShieldCheck size={22} /> ระบบภายในหน่วยงาน · ฐานข้อมูลส่วนกลาง
          </div>
        </div>
        <div className="login-form">
          <h2>เข้าสู่ระบบ</h2>
          <p>เลือกจุดบริการหลังเข้าสู่ระบบ</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const data = Object.fromEntries(new FormData(e.currentTarget));
              try {
                const result = await api<{ user: UserDto }>('/api/auth', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(data),
                });
                setUser(result.user);
                setStationId('');
                setEventId('');
                setView(
                  result.user.roleName === 'ADMIN'
                    ? 'registrations'
                    : result.user.roleName === 'CASHIER'
                      ? 'pos'
                      : result.user.roleName === 'PAYMENT_CASHIER'
                        ? 'payments'
                        : 'dashboard',
                );
                notify('');
              } catch (e) {
                notify(e instanceof Error ? e.message : 'Login failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              ชื่อผู้ใช้งาน
              <input name="username" autoComplete="username" required />
            </label>
            <label>
              รหัสผ่าน
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            {message && (
              <p role="alert" className="error">
                {message}
              </p>
            )}
            <button className="primary" disabled={busy}>
              เข้าสู่ระบบ →
            </button>
          </form>
          <small>CCIDA Event POS & Payment Management</small>
        </div>
      </main>
    );
  return (
    <AppContext.Provider
      value={{ user, events, stations, eventId, stationId, busy, revision, op, notify, print }}
    >
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">C</div>
            <div>
              <strong>CCIDA</strong>
              <small>EVENT POS</small>
            </div>
          </div>
          <p className="nav-caption">การปฏิบัติงาน</p>
          <nav>
            {nav.map(([id, label, Icon]) => {
              const NavIcon = Icon as typeof LayoutDashboard;
              return (
                <button
                  key={String(id)}
                  className={view === id ? 'selected' : ''}
                  onClick={() => setView(String(id))}
                >
                  <NavIcon size={19} />
                  {String(label)}
                </button>
              );
            })}
          </nav>
          <div className="sidebar-footer">
            <span className="online-dot" /> CENTRAL SERVER
            <small>ข้อมูลการเงินจัดเก็บที่ส่วนกลาง</small>
          </div>
        </aside>
        <div className="workspace">
          <header>
            <div className="selectors">
              <label>
                กิจกรรม
                <select
                  aria-label="กิจกรรม"
                  value={eventId}
                  onChange={(e) => {
                    setEventId(e.target.value);
                    try {
                      sessionStorage.setItem(`ccida:event:${user.id}`, e.target.value);
                    } catch {
                      /* Device preference remains in memory. */
                    }
                  }}
                >
                  <option value="">เลือกกิจกรรม</option>
                  {events.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} · {e.status}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                จุดบริการ
                <select
                  aria-label="จุดบริการ"
                  value={stationId}
                  onChange={(e) => {
                    setStationId(e.target.value);
                    try {
                      sessionStorage.setItem(`ccida:station:${user.id}`, e.target.value);
                    } catch {
                      /* Device preference remains in memory. */
                    }
                  }}
                >
                  <option value="">เลือกจุดบริการ</option>
                  {stations
                    .filter((s) => s.active)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} · {s.type}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <div className="user-menu">
              <div>
                <strong>{user.displayName}</strong>
                <small>{roleLabels[user.roleName]}</small>
              </div>
              <button
                aria-label="ออกจากระบบ"
                onClick={async () => {
                  try {
                    await api('/api/auth', { method: 'DELETE' });
                    setUser(null);
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                <LogOut size={18} />
              </button>
            </div>
          </header>
          <main>
            <div className="page-heading">
              <div>
                <span className="eyebrow">
                  OPERATIONS / {events.find((e) => e.id === eventId)?.code ?? 'CCIDA'}
                </span>
                <h1>{String(nav.find((n) => n[0] === view)?.[1] ?? 'CCIDA POS')}</h1>
              </div>
              <span className="status-note">● ฐานข้อมูลส่วนกลาง</span>
            </div>
            {message && (
              <div className="notice" role="status">
                <span>{message}</span>
                <button aria-label="ปิดข้อความ" onClick={() => notify('')}>
                  ×
                </button>
              </div>
            )}
            <ShiftBar />
            {view === 'backups' ? (
              <BackupScreen />
            ) : view === 'shifts' ? (
              <ShiftsScreen />
            ) : view === 'stock' ? (
              <StockScreen />
            ) : view === 'closing' ? (
              <ClosingScreen />
            ) : view === 'dashboard' ? (
              <DashboardScreen key={eventId} />
            ) : view === 'outstanding' ? (
              <OutstandingScreen key={eventId} />
            ) : view === 'reports' ? (
              <ReportsScreen key={eventId} />
            ) : view === 'controls' || view === 'audit' ? (
              <ControlsScreen key={view} auditOnly={view === 'audit'} />
            ) : view === 'payments' ? (
              <PaymentScreen key={eventId + stationId} />
            ) : view === 'pos' ? (
              <PosScreen key={eventId + stationId} />
            ) : view === 'products' ? (
              <CatalogScreen />
            ) : view === 'registrations' ? (
              <RegistrationScreen />
            ) : ['events', 'users', 'stations', 'settings'].includes(view) ? (
              <>
                <ManagementScreen
                  key={view}
                  view={view as 'events' | 'users' | 'stations' | 'settings'}
                />
                {view === 'settings' && <PromptPaySettings />}
              </>
            ) : (
              <section className="panel">เลือกกิจกรรมและจุดบริการเพื่อเริ่มปฏิบัติงาน</section>
            )}
          </main>
        </div>
      </div>
      {printData && (
        <div className="print-overlay">
          <div className="print-actions">
            <button
              className="primary"
              onClick={() => {
                try {
                  window.print();
                } catch {
                  notify('เครื่องพิมพ์ไม่พร้อมใช้งาน / Printer unavailable.');
                }
              }}
            >
              พิมพ์บัตร QR
            </button>
            <button onClick={() => setPrintData(null)}>ปิด</button>
            <p>หากเครื่องพิมพ์ไม่ตอบสนอง ให้ตรวจสอบเครื่องและลองพิมพ์ใหม่</p>
          </div>
          <div className="print-document">
            <h2>CCIDA</h2>
            <p>{events.find((e) => e.id === eventId)?.name}</p>
            <h3>{printData.number}</h3>
            <p>{printData.customerName}</p>
            <Image unoptimized src={printData.qrImage} width={240} height={240} alt="Customer QR" />
            <p>ใช้ QR นี้ทุกจุดขาย · ชำระก่อนออก</p>
          </div>
        </div>
      )}
    </AppContext.Provider>
  );
}
