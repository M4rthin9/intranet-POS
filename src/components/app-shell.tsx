'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useRouter } from 'next/navigation';
import { rolePages, viewPaths, homePath, canView, type AppView } from '../lib/role-pages';
import { isPosCashier } from '../lib/pos-mode';
import {
  LayoutDashboard,
  Users,
  ShoppingCart,
  CreditCard,
  CalendarDays,
  Settings,
  LogOut,
  ShieldCheck,
  MessageSquareHeart,
  Tags,
} from 'lucide-react';
import { AppContext, api, ApiError } from './context';
import type { UserDto, EventDto, StationDto, PrintDto } from './types';
import { RegistrationScreen } from './registration-screen';
import { ManagementScreen } from './management-screen';
import { PosScreen } from './pos-screen';
import { CatalogScreen } from './catalog-screen';
import { ProductTagsScreen } from './product-tags-screen';
import { ShiftBar } from './shift-bar';
import { PaymentScreen } from './payment-screen';
import { PromptPaySettings } from './promptpay-settings';
import { EventSalesSettings } from './event-sales-settings';
import { ControlsScreen } from './controls-screen';
import { DashboardScreen, ReportsScreen } from './dashboard-screen';
import { OutstandingScreen } from './outstanding-screen';
import { ShiftsScreen, StockScreen } from './operations-screen';
import { BackupScreen } from './backup-screen';
import { QrCard } from './qr-card';
import { PrintPortal } from './print-portal';
import { EventScreen } from './event-screen';
import { FeedbackScreen } from './feedback-screen';
export function AppShell({
  initialUser,
  initialView = 'dashboard',
}: {
  initialUser?: UserDto;
  initialView?: AppView;
}) {
  const router = useRouter();
  const [user, setUser] = useState<UserDto | null>(initialUser ?? null);
  const registrationOnly = user?.roleName === 'REGISTRATION_CASHIER';
  const paymentOnly = user?.roleName === 'PAYMENT_CASHIER';
  const [events, setEvents] = useState<EventDto[]>([]);
  const [stations, setStations] = useState<StationDto[]>([]);
  const [eventId, setEventId] = useState('');
  const [stationId, setStationId] = useState('');
  const [shiftOpen, setShiftOpen] = useState(false);
  const [contextView, setContextView] = useState<AppView | null>(null);
  const view =
    user && !canView(user.roleName, initialView) ? rolePages[user.roleName].home : initialView;
  const posTerminal = view === 'pos';
  const analyticsView = ['dashboard', 'reports', 'outstanding', 'audit', 'events'].includes(view);
  const globalView = [
    'products',
    'productTags',
    'users',
    'backups',
    'settings',
    'feedback',
  ].includes(view);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [printData, setPrintData] = useState<PrintDto | null>(null);
  const [cardPrintError, setCardPrintError] = useState('');
  const [cardPrinting, setCardPrinting] = useState(false);
  const cardPrintRef = useRef<HTMLDivElement>(null);
  const analyticsSelection = useRef<string | null>(null);
  const notify = useCallback((text: string) => setMessage(text), []);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      let savedEvent: string | null = null;
      let savedStation: string | null = null;
      let savedAnalytics: string | null = null;
      try {
        if (user) {
          savedEvent = sessionStorage.getItem(`ccida:event:${user.id}`);
          savedStation = sessionStorage.getItem(`ccida:station:${user.id}`);
          savedAnalytics = sessionStorage.getItem(`ccida:analytics-event:${user.id}`);
        }
      } catch {
        /* Device preferences are optional. */
      }
      const allEvents = await api<EventDto[]>('/api/data?view=events', { signal });
      if (signal?.aborted) return;
      setEvents(allEvents);
      if (!allEvents.length) {
        setEventId('');
        setStationId('');
        setStations([]);
        setShiftOpen(false);
        setContextView(view);
        if (user?.roleName !== 'SUPER_ADMIN')
          notify('ยังไม่ได้ผูกกิจกรรม กรุณาติดต่อ Super Admin เพื่อผูกกิจกรรมให้บัญชีนี้');
        return;
      }
      if (view === 'payments' && !allEvents.some((event) => event.status === 'OPEN')) {
        setEventId(
          allEvents.find((event) => event.id === savedEvent)?.id ?? allEvents[0]?.id ?? '',
        );
        setStationId('');
        setStations([]);
        setShiftOpen(false);
        setContextView(view);
        return;
      }
      if (analyticsView || globalView) {
        const selected =
          allEvents.find(
            (event) => event.id === (savedAnalytics ?? analyticsSelection.current ?? savedEvent),
          ) ??
          allEvents.find((event) => event.status === 'OPEN') ??
          allEvents[0];
        setEventId(selected?.id ?? '');
        setContextView(view);
        return;
      }
      const resolved = await api<{ event: EventDto; station: StationDto; shiftOpen: boolean }>(
        '/api/operations',
        {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'context.resolve',
            input: {
              ...(savedEvent ? { eventId: savedEvent } : {}),
              ...(savedStation ? { stationId: savedStation } : {}),
            },
          }),
        },
      );
      if (signal?.aborted) return;
      setEvents(
        allEvents.some((event) => event.id === resolved.event.id)
          ? allEvents
          : [resolved.event, ...allEvents],
      );
      setStations([resolved.station]);
      setEventId(resolved.event.id);
      setStationId(resolved.station.id);
      setShiftOpen(resolved.shiftOpen);
      setContextView(view);
      try {
        if (user) {
          sessionStorage.setItem(`ccida:event:${user.id}`, resolved.event.id);
          sessionStorage.setItem(`ccida:station:${user.id}`, resolved.station.id);
        }
      } catch {
        /* Device preferences are optional; the server retains the assignment. */
      }
    },
    [user, analyticsView, globalView, view, notify],
  );
  useEffect(() => {
    const controller = new AbortController();
    if (user)
      Promise.resolve()
        .then(() => refresh(controller.signal))
        .catch((e) => {
          if (!controller.signal.aborted) notify(e.message);
        });
    return () => controller.abort();
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
      if (action === 'shift.open') setShiftOpen(true);
      if (!['account.lookup', 'payment.resume'].includes(action)) {
        setRevision((r) => r + 1);
        setMessage('บันทึกสำเร็จ');
      }
      return result;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setUser(null);
        window.location.replace('/');
      }
      notify(e instanceof Error ? e.message : 'Operation failed');
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function selectEvent(id: string, purpose: 'analytics' | 'operations') {
    if (!user) return;
    if (purpose === 'analytics') {
      if (!events.some((event) => event.id === id)) throw new Error('Event not found.');
      analyticsSelection.current = id;
      try {
        sessionStorage.setItem(`ccida:analytics-event:${user.id}`, id);
      } catch {
        /* Optional device preference. */
      }
      setEventId(id);
      return;
    }
    const resolved = await op<{ event: EventDto; station: StationDto; shiftOpen: boolean }>(
      'context.resolve',
      {
        eventId: id,
        ...(stationId ? { stationId } : {}),
        switchEvent: true,
      },
    );
    try {
      sessionStorage.setItem(`ccida:event:${user.id}`, resolved.event.id);
      sessionStorage.setItem(`ccida:station:${user.id}`, resolved.station.id);
    } catch {
      /* Optional device preference. */
    }
    setEventId(resolved.event.id);
    setStationId(resolved.station.id);
    setShiftOpen(resolved.shiftOpen);
  }
  const print = useCallback((value: PrintDto) => {
    setCardPrintError('');
    setPrintData(value);
  }, []);
  const nav = [
    ['dashboard', 'ภาพรวม', LayoutDashboard],
    ['events', 'กิจกรรม', CalendarDays],
    ['pos', 'ขายสินค้า', ShoppingCart],
    ['payments', 'รับชำระเงิน', CreditCard],
    ['registrations', 'ลงทะเบียน', Users],
    ['stock', 'สต็อก', ShoppingCart],
    ['shifts', 'กะปฏิบัติงาน', CalendarDays],
    ['outstanding', 'ยอดค้างชำระ', CreditCard],
    ['reports', 'รายงาน', LayoutDashboard],
    ['feedback', 'ความคิดเห็น', MessageSquareHeart],
    ['controls', 'ควบคุม / VOID', ShieldCheck],
    ['audit', 'บันทึกตรวจสอบ', ShieldCheck],
    ['products', 'สินค้า', ShoppingCart],
    ['productTags', 'พิมพ์ป้ายสินค้า / Product tags', Tags],
    ['users', 'ผู้ใช้งาน', ShieldCheck],
    ['backups', 'สำรองข้อมูล', ShieldCheck],
    ['settings', 'ตั้งค่า', Settings],
  ].filter(([id]) => user && canView(user.roleName, id as AppView));
  if (!user)
    return (
      <main className="login">
        <div className="login-card">
          <div className="login-brand">
            <div className="brand-mark">C</div>
            <span className="eyebrow">CCIDA · POS OPERATIONS</span>
            <h1>CCIDA POS</h1>
            <p>ซื้อหลายครั้ง · QR เดียว · ชำระก่อนออก</p>
          </div>
          <div className="login-form">
            <h2>เข้าสู่ระบบ</h2>
            <p>เข้าสู่ระบบเพื่อเริ่มปฏิบัติงาน</p>
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
                  window.location.replace(homePath(result.user.roleName));
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
            <small>CCIDA POS & Payment Management</small>
          </div>
        </div>
      </main>
    );
  return (
    <AppContext.Provider
      value={{
        user,
        events,
        stations,
        eventId,
        stationId,
        busy,
        revision,
        op,
        notify,
        print,
        selectEvent,
      }}
    >
      <div
        className={`app${registrationOnly ? ' registration-only' : ''}${posTerminal ? ' pos-workspace pos-cashier' : ''}${view === 'payments' ? ' payment-workspace' : ''}${paymentOnly ? ' payment-cashier' : ''}`}
      >
        {!registrationOnly && !posTerminal && !paymentOnly && (
          <aside className="sidebar">
            <div className="brand">
              <div className="brand-mark">C</div>
              <div>
                <strong>CCIDA</strong>
                <small>POS</small>
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
                    onClick={() => router.push(viewPaths[id as AppView])}
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
        )}
        <div className="workspace">
          <header>
            <strong className="header-title">
              {posTerminal && <ShoppingCart size={23} aria-hidden="true" />}
              {registrationOnly
                ? 'CCIDA · ลงทะเบียน'
                : paymentOnly
                  ? 'CCIDA · รับชำระเงิน'
                  : 'CCIDA POS'}
            </strong>
            <div className="user-menu">
              {posTerminal && !isPosCashier(user.roleName) && (
                <button
                  className="pos-management-link"
                  onClick={() => router.push(homePath(user.roleName))}
                >
                  <LayoutDashboard size={16} /> กลับหน้าจัดการ
                </button>
              )}
              <div>
                <strong>{user.displayName}</strong>
                <small>{rolePages[user.roleName].label}</small>
              </div>
              <button
                aria-label="ออกจากระบบ"
                onClick={async () => {
                  try {
                    await api('/api/auth', { method: 'DELETE' });
                    setUser(null);
                    window.location.replace('/');
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
                <span className="eyebrow">OPERATIONS / CCIDA</span>
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
            {!globalView && user.roleName === 'SUPER_ADMIN' && (
              <section className="event-context" aria-label="กิจกรรมที่เลือก">
                <label>
                  {analyticsView ? 'กิจกรรมสำหรับดูสถิติ' : 'กิจกรรมสำหรับปฏิบัติงาน'}
                  <select
                    aria-label="กิจกรรม"
                    value={eventId}
                    disabled={busy || contextView !== view || (!analyticsView && shiftOpen)}
                    onChange={async (event) => {
                      try {
                        await selectEvent(
                          event.target.value,
                          analyticsView ? 'analytics' : 'operations',
                        );
                      } catch {
                        /* Application notice displays the error. */
                      }
                    }}
                  >
                    {!eventId && <option value="">เลือกกิจกรรม</option>}
                    {events
                      .filter(
                        (event) => analyticsView || event.status === 'OPEN' || event.id === eventId,
                      )
                      .map((event) => (
                        <option
                          key={event.id}
                          value={event.id}
                          disabled={!analyticsView && event.status !== 'OPEN'}
                        >
                          {event.code} · {event.name} · {event.status}
                        </option>
                      ))}
                  </select>
                </label>
                <small>
                  {analyticsView
                    ? 'ยอดขายและรายงานแยกตามกิจกรรมที่เลือก'
                    : shiftOpen
                      ? 'ปิดกะก่อนเปลี่ยนกิจกรรม เพื่อเก็บยอดขายให้ตรงงาน'
                      : 'ทะเบียนและรายการขายจะบันทึกในกิจกรรมนี้'}
                </small>
              </section>
            )}
            {!globalView && user.roleName !== 'SUPER_ADMIN' && eventId && (
              <section
                className="staff-event"
                data-event-id={eventId}
                aria-label="กิจกรรมที่ได้รับมอบหมาย"
              >
                <small>กิจกรรมที่ได้รับมอบหมาย</small>
                <strong>{events.find((event) => event.id === eventId)?.name}</strong>
                <span>{events.find((event) => event.id === eventId)?.code}</span>
              </section>
            )}
            {user.roleName === 'SUPER_ADMIN' &&
              !analyticsView &&
              !globalView &&
              stationId &&
              contextView === view && <ShiftBar key={`shiftbar:${eventId}`} />}
            {contextView !== view ? (
              <section className="panel empty">กำลังโหลดกิจกรรม</section>
            ) : view === 'events' ? (
              <EventScreen />
            ) : !eventId && !globalView && view !== 'payments' ? (
              <section className="panel empty">
                {user.roleName === 'SUPER_ADMIN'
                  ? 'ยังไม่มีกิจกรรม กรุณาลงทะเบียนกิจกรรมก่อนเริ่มงาน'
                  : 'กรุณาติดต่อ Super Admin เพื่อผูกกิจกรรมให้บัญชีนี้'}
              </section>
            ) : view === 'backups' ? (
              <BackupScreen />
            ) : view === 'feedback' ? (
              <FeedbackScreen />
            ) : view === 'shifts' ? (
              <ShiftsScreen key={eventId} />
            ) : view === 'stock' ? (
              <StockScreen key={eventId} />
            ) : view === 'dashboard' ? (
              <DashboardScreen key={eventId} />
            ) : view === 'outstanding' ? (
              <OutstandingScreen key={eventId} />
            ) : view === 'reports' ? (
              <ReportsScreen key={eventId} />
            ) : view === 'controls' || view === 'audit' ? (
              <ControlsScreen key={`${view}:${eventId}`} auditOnly={view === 'audit'} />
            ) : view === 'payments' ? (
              <PaymentScreen key={eventId + stationId} />
            ) : view === 'pos' ? (
              <PosScreen key={eventId + stationId} />
            ) : view === 'products' ? (
              <CatalogScreen />
            ) : view === 'productTags' ? (
              <ProductTagsScreen />
            ) : view === 'registrations' ? (
              <RegistrationScreen key={eventId + stationId} />
            ) : ['users', 'settings'].includes(view) ? (
              <>
                <ManagementScreen key={view} view={view as 'users' | 'settings'} />
                {view === 'settings' && <PromptPaySettings />}
                {view === 'settings' && <EventSalesSettings />}
              </>
            ) : (
              <section className="panel">กำลังเตรียมระบบสำหรับปฏิบัติงาน</section>
            )}
          </main>
        </div>
      </div>
      {printData && (
        <PrintPortal>
          <div className="print-overlay qr-print-overlay">
            <div className="print-actions">
              <button
                className="primary"
                disabled={busy || cardPrinting}
                onClick={async () => {
                  try {
                    setCardPrinting(true);
                    setCardPrintError('');
                    if (printData.registrationId) {
                      const fresh = await op<PrintDto>('qr.print', {
                        registrationId: printData.registrationId,
                      });
                      flushSync(() => setPrintData(fresh));
                    }
                    await cardPrintRef.current?.querySelector('img')?.decode();
                    window.print();
                  } catch {
                    setCardPrintError(
                      'เครื่องพิมพ์หรือเซิร์ฟเวอร์ไม่พร้อมใช้งาน / Printer unavailable. กรุณาตรวจสอบแล้วลองใหม่',
                    );
                    notify('เครื่องพิมพ์ไม่พร้อมใช้งาน / Printer unavailable.');
                  } finally {
                    setCardPrinting(false);
                  }
                }}
              >
                พิมพ์บัตร QR
              </button>
              <button disabled={busy || cardPrinting} onClick={() => setPrintData(null)}>
                ปิด
              </button>
              <p>กระดาษ 80 มม. · ความยาว 120 มม. · ขนาดจริง 100% · ปิดหัว/ท้ายกระดาษ</p>
              {cardPrintError && (
                <p className="error" role="alert">
                  {cardPrintError}
                </p>
              )}
            </div>
            <div ref={cardPrintRef}>
              <QrCard kind="customer" {...printData} />
            </div>
          </div>
        </PrintPortal>
      )}
    </AppContext.Provider>
  );
}
