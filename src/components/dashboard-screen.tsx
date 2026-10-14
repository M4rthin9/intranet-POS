'use client';
import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Users,
  ShoppingBag,
  Wallet,
  ReceiptText,
  Activity,
  Download,
  Printer,
} from 'lucide-react';
import { api, useApp, money, time } from './context';
import { Badge } from './ui';
import type { Summary, Metric } from '../lib/reports';
export function BarChart({ data, title }: { data: Metric[]; title: string }) {
  const visible = data.slice(0, 8);
  const max = Math.max(1, ...visible.map((d) => d.amountSatang));
  return (
    <section className="panel chart">
      <h2>{title}</h2>
      {visible.length ? (
        visible.map((d, i) => (
          <div className="bar-row" key={d.label}>
            <div className="bar-label">
              <span>{d.label}</span>
              <strong>{money(d.amountSatang)}</strong>
            </div>
            <div className="bar-track">
              <span
                style={{
                  width: `${Math.max(1, (d.amountSatang / max) * 100)}%`,
                  opacity: 1 - i * 0.06,
                }}
              />
            </div>
          </div>
        ))
      ) : (
        <div className="empty">ยังไม่มีรายการ</div>
      )}
    </section>
  );
}
export function TrendChart({ data, title }: { data: Metric[]; title: string }) {
  const rows = data.slice(-24);
  const max = Math.max(1, ...rows.map((d) => d.amountSatang));
  const points = rows
    .map(
      (d, i) =>
        `${30 + i * (540 / Math.max(1, rows.length - 1))},${170 - (d.amountSatang / max) * 140}`,
    )
    .join(' ');
  return (
    <section className="panel chart">
      <h2>{title}</h2>
      {rows.length ? (
        <>
          <svg viewBox="0 0 600 210" role="img" aria-label={title}>
            <line x1="30" y1="170" x2="570" y2="170" stroke="#dae2e8" />
            <line x1="30" y1="100" x2="570" y2="100" stroke="#eef2f5" />
            <polyline points={points} fill="none" stroke="#237966" strokeWidth="3" />
            {rows.map((d, i) => (
              <circle
                key={d.label}
                cx={30 + i * (540 / Math.max(1, rows.length - 1))}
                cy={170 - (d.amountSatang / max) * 140}
                r="4"
                fill="#237966"
              >
                <title>
                  {d.label}: {money(d.amountSatang)}
                </title>
              </circle>
            ))}
            <text x="30" y="200" fontSize="11" fill="#607185">
              {rows[0].label}
            </text>
            <text x="570" y="200" textAnchor="end" fontSize="11" fill="#607185">
              {rows[rows.length - 1].label}
            </text>
          </svg>
          <div className="trend-total">
            ล่าสุด <strong>{money(rows[rows.length - 1].amountSatang)}</strong>
          </div>
        </>
      ) : (
        <div className="empty">ยังไม่มีรายการ</div>
      )}
    </section>
  );
}
export function useSummary(from = '', to = '') {
  const { eventId, revision, notify } = useApp();
  const [data, setData] = useState<Summary | null>(null);
  useEffect(() => {
    if (!eventId) return;
    const controller = new AbortController();
    const load = () =>
      api<Summary>(`/api/reports?eventId=${eventId}&from=${from}&to=${to}`, {
        signal: controller.signal,
      })
        .then(setData)
        .catch((e) => {
          if (!controller.signal.aborted) notify(e.message);
        });
    load();
    const timer = setInterval(load, 5000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [eventId, revision, notify, from, to]);
  return data;
}
export function DashboardScreen() {
  const data = useSummary();
  if (!data) return <section className="panel empty">เลือกกิจกรรม · กำลังโหลดภาพรวม</section>;
  const kpis = [
    {
      label: 'ผู้ลงทะเบียน',
      value: String(data.registered),
      sub: `ใช้งาน ${data.active} · ระงับ ${data.blocked}`,
      icon: Users,
    },
    {
      label: 'บัญชีชำระแล้ว',
      value: String(data.settled),
      sub: 'SETTLED ACCOUNTS',
      icon: ReceiptText,
    },
    {
      label: 'รายการขาย',
      value: String(data.orders),
      sub: `เฉลี่ย ${money(data.averageOrderSatang)} / รายการ`,
      icon: ShoppingBag,
    },
    {
      label: 'ยอดขายก่อน VOID',
      value: money(data.grossSalesSatang),
      sub: `หลัง VOID ${money(data.netSalesSatang)}`,
      icon: ArrowUpRight,
    },
    {
      label: 'รับชำระยืนยันแล้ว',
      value: money(data.confirmedPaymentSatang),
      sub: `${data.confirmedPayments} การชำระ`,
      icon: Wallet,
    },
    {
      label: 'ยอดค้างชำระ',
      value: money(data.outstandingSatang),
      sub: `${data.outstandingAccounts} บัญชียังไม่ชำระ`,
      icon: Activity,
    },
    {
      label: 'VOID รายการขาย',
      value: String(data.voidOrders),
      sub: money(data.voidOrderSatang),
      icon: ReceiptText,
    },
    {
      label: 'VOID / คืนเงิน',
      value: String(data.voidPayments),
      sub: money(data.voidPaymentSatang),
      icon: ReceiptText,
    },
  ];
  return (
    <>
      <div className="dashboard-note">
        <span>ข้อมูลล่าสุด {time(data.asOf)} · อัปเดตทุก 5 วินาที</span>
        <Badge>{data.reconciled ? 'RECONCILED' : 'RECONCILIATION ALERT'}</Badge>
      </div>
      <div className="kpis">
        {kpis.map((k) => (
          <section className="kpi" key={k.label}>
            <div>
              <span>{k.label}</span>
              <k.icon size={18} />
            </div>
            <strong>{k.value}</strong>
            <small>{k.sub}</small>
          </section>
        ))}
      </div>
      <div className="split">
        <TrendChart title="ยอดขายตามชั่วโมง" data={data.byHour} />
        <BarChart title="ยอดขายตามหมวดหมู่" data={data.byCategory} />
        <BarChart title="สินค้าขายดี" data={data.byProduct} />
        <BarChart title="ยอดขายตามจุดขาย" data={data.byStation} />
        <BarChart title="ยอดขายตามเจ้าหน้าที่" data={data.byCashier} />
        <TrendChart title="การชำระเงินตามเวลา" data={data.paymentTimeline} />
        <TrendChart title="ยอดค้างชำระสะสม" data={data.outstandingTrend} />
        <TrendChart title="แนวโน้มรายการ VOID" data={data.voidTrend} />
      </div>
    </>
  );
}
export function ReportsScreen() {
  const app = useApp();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tab, setTab] = useState('products');
  const data = useSummary(from, to);
  const tabs = [
    ['products', 'สินค้า'],
    ['categories', 'หมวดหมู่'],
    ['stations', 'จุดขาย'],
    ['cashiers', 'เจ้าหน้าที่'],
    ['payments', 'การชำระ'],
    ['outstanding', 'ยอดค้าง'],
    ['registrations', 'ทะเบียน'],
    ['voids', 'VOID'],
    ['shifts', 'กะ'],
  ];
  const metrics = data
    ? tab === 'products'
      ? data.byProduct
      : tab === 'categories'
        ? data.byCategory
        : tab === 'stations'
          ? data.byStation
          : tab === 'cashiers'
            ? data.byCashier
            : []
    : [];
  const exportUrl = (type: string) =>
    `/api/export?eventId=${app.eventId}&type=${type}&from=${from}&to=${to}`;
  return (
    <div className="report-print">
      <section className="panel report-controls">
        <h2>รายงานกิจกรรม · รายวัน · ช่วงวันที่</h2>
        <div className="report-filters">
          <label>
            ตั้งแต่
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            ถึง
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button
            onClick={() => {
              setFrom('');
              setTo('');
            }}
          >
            ทั้งกิจกรรม
          </button>
          <a className="button" href={exportUrl('summary')}>
            <Download size={16} /> CSV สรุป
          </a>
          <button onClick={() => window.print()}>
            <Printer size={16} /> พิมพ์ / PDF
          </button>
        </div>
        <p className="muted">วันรายงานอ้างอิงเวลาไทย · ยอดค้างและทะเบียนแสดงสถานะปัจจุบัน</p>
      </section>
      {data && (
        <>
          <section className="panel">
            <h2>
              {app.events.find((e) => e.id === app.eventId)?.name} · {from || 'เริ่มกิจกรรม'} ถึง{' '}
              {to || 'ปัจจุบัน'}
            </h2>
            <div className="report-totals">
              <div>
                ยอดขายก่อน VOID<strong>{money(data.grossSalesSatang)}</strong>
              </div>
              <div>
                ยอดขายหลัง VOID<strong>{money(data.netSalesSatang)}</strong>
              </div>
              <div>
                รับชำระยืนยัน<strong>{money(data.confirmedPaymentSatang)}</strong>
              </div>
              <div>
                ยอดค้างปัจจุบัน<strong>{money(data.outstandingSatang)}</strong>
              </div>
            </div>
            {!data.rangeFiltered && (
              <p>
                กระทบยอด: {data.reconciled ? 'ตรงกัน' : 'ต้องตรวจสอบ'} · ยอดขายหลัง VOID =
                รับชำระยืนยัน + ยอดค้าง
              </p>
            )}
          </section>
          <div className="split">
            <TrendChart title="ยอดขายรายชั่วโมง / รายวัน" data={data.byHour} />
            <BarChart title="ยอดขายตามหมวดหมู่" data={data.byCategory} />
          </div>
          <section className="panel">
            <div className="category-tabs">
              {tabs.map(([id, label]) => (
                <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </div>
            <a className="button" href={exportUrl(tab)}>
              <Download size={16} /> ส่งออก {tabs.find((t) => t[0] === tab)?.[1]} CSV
            </a>
            {metrics.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>รายการ</th>
                    <th>จำนวน</th>
                    <th>ยอดขาย</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((m) => (
                    <tr key={m.label}>
                      <td>{m.label}</td>
                      <td>{m.quantity}</td>
                      <td>{money(m.amountSatang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tab === 'outstanding' && (
              <table>
                <thead>
                  <tr>
                    <th>ทะเบียน</th>
                    <th>ผู้ร่วมงาน</th>
                    <th>สถานะ</th>
                    <th>ยอดค้าง</th>
                  </tr>
                </thead>
                <tbody>
                  {data.outstanding.map((r) => (
                    <tr key={r.id}>
                      <td>{r.registrationNumber}</td>
                      <td>{r.customerName}</td>
                      <td>{r.status}</td>
                      <td>{money(r.amountSatang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!metrics.length && tab !== 'outstanding' && (
              <p>ส่งออก CSV เพื่อดูข้อมูลครบทุกแถว รวมทั้งสถานะและประวัติการแก้ไข</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
