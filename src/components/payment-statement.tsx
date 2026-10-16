'use client';
import { useEffect, useState } from 'react';
import { Download, Landmark, RefreshCw, Search, Wallet, QrCode, Banknote } from 'lucide-react';
import { api, money, time, useApp } from './context';
import type { PaymentStatement } from '../lib/payment-statement';
import './payment-statement.css';

export function PaymentStatementView({ from, to }: { from: string; to: string }) {
  const { eventId, revision } = useApp();
  const [data, setData] = useState<PaymentStatement | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState('ALL');
  useEffect(() => {
    const controller = new AbortController();
    api<PaymentStatement>(`/api/reports?view=statement&eventId=${eventId}&from=${from}&to=${to}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) {
          setData(value);
          setError('');
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [eventId, revision, from, to, refresh]);
  if (error)
    return (
      <section className="panel">
        <p role="alert" className="error">
          {error}
        </p>
        <button onClick={() => setRefresh((n) => n + 1)}>ลองใหม่</button>
      </section>
    );
  if (!data)
    return (
      <section className="panel empty" role="status">
        กำลังเตรียมรายการเดินบัญชี…
      </section>
    );
  const query = search.trim().toLocaleLowerCase();
  const rows = data.rows.filter(
    (row) =>
      (method === 'ALL' || row.method === method) &&
      [row.number, row.reference, row.customerName, row.registrationNumber, row.method, row.cashier]
        .join(' ')
        .toLocaleLowerCase()
        .includes(query),
  );
  return (
    <section className="statement">
      <header className="statement-heading">
        <div className="statement-brand">
          <span>
            <Landmark size={27} />
          </span>
          <div>
            <small>CCIDA · EVENT FINANCE</small>
            <h2>รายงานรับชำระเงิน</h2>
            <p>PAYMENT STATEMENT</p>
          </div>
        </div>
        <div className="statement-event">
          <strong>{data.event.name}</strong>
          <span>{data.event.code}</span>
          <small>ข้อมูล ณ {time(data.asOf)}</small>
        </div>
      </header>
      <div className="statement-period">
        <div>
          <small>รอบรายงาน · เวลาไทย</small>
          <strong>
            {from || 'เริ่มกิจกรรม'} — {to || 'ปัจจุบัน'}
          </strong>
        </div>
        <div>
          <small>รายการยืนยันรับเงิน</small>
          <strong>{data.rows.length.toLocaleString()} รายการ</strong>
        </div>
      </div>
      <div className="statement-summary">
        <div>
          <Wallet size={20} />
          <span>รับชำระทั้งหมด</span>
          <strong>{money(data.receivedSatang)}</strong>
          <small>ยอดรับในช่วงวันที่เลือก</small>
        </div>
        <div>
          <QrCode size={20} />
          <span>QR พร้อมเพย์</span>
          <strong>{money(data.promptPaySatang)}</strong>
          <small>สำหรับตรวจเทียบรายการเงินเข้าธนาคาร</small>
        </div>
        <div>
          <Banknote size={20} />
          <span>เงินสด</span>
          <strong>{money(data.cashSatang)}</strong>
          <small>ยอดรับสุทธิหลังหักเงินทอน</small>
        </div>
      </div>
      <div className="statement-ledger-heading">
        <div>
          <h3>รายการเคลื่อนไหว / Transactions</h3>
          <p>เฉพาะรับชำระยืนยันแล้ว · เรียงตามวันและเวลารับเงิน</p>
        </div>
        <div className="statement-tools">
          <select
            aria-label="กรองวิธีชำระเงิน"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="ALL">ทุกวิธีชำระ</option>
            <option value="PROMPTPAY">QR PromptPay</option>
            <option value="CASH">เงินสด / Cash</option>
          </select>
          <label>
            <Search size={16} />
            <input
              aria-label="ค้นหารายการรับชำระ"
              placeholder="ค้นหาชื่อ / ใบเสร็จ / อ้างอิง"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button aria-label="อัปเดตรายงาน" onClick={() => setRefresh((n) => n + 1)}>
            <RefreshCw size={17} />
          </button>
          <a
            className="button"
            href={`/api/export?type=statement&eventId=${eventId}&from=${from}&to=${to}`}
          >
            <Download size={17} /> CSV
          </a>
        </div>
      </div>
      <div className="statement-table-wrap">
        <table className="statement-table">
          <thead>
            <tr>
              <th>วัน / เวลา</th>
              <th>รายละเอียด / เลขที่ใบเสร็จ</th>
              <th>วิธีชำระ</th>
              <th>อ้างอิง / จุดรับเงิน</th>
              <th className="statement-numeric">รับเงิน (บาท)</th>
              <th className="statement-numeric">ยอดรับสะสม (บาท)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="statement-opening">
              <td colSpan={5}>ยอดยกมา · รับชำระยืนยันก่อนช่วงวันที่เลือก</td>
              <td className="statement-numeric">{money(data.openingSatang)}</td>
            </tr>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="statement-date">{time(row.confirmedAt)}</td>
                <td>
                  <strong>{row.customerName}</strong>
                  <small>
                    {row.number} · {row.registrationNumber}
                  </small>
                </td>
                <td>
                  <span className={`statement-method ${row.method === 'CASH' ? 'is-cash' : ''}`}>
                    {row.method === 'CASH'
                      ? 'เงินสด'
                      : row.method === 'PROMPTPAY'
                        ? 'PromptPay'
                        : row.method}
                  </span>
                </td>
                <td>
                  <span>{row.reference || '—'}</span>
                  <small>
                    {row.station} · {row.cashier}
                  </small>
                </td>
                <td className="statement-numeric statement-credit">{money(row.amountSatang)}</td>
                <td className="statement-numeric">{money(row.balanceSatang)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="statement-empty">
                  {query ? 'ไม่พบรายการที่ค้นหา' : 'ยังไม่มีรายการยืนยันรับชำระในช่วงวันที่นี้'}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>รวมรับชำระในช่วงวันที่เลือก</td>
              <td className="statement-numeric">{money(data.receivedSatang)}</td>
              <td className="statement-numeric">{money(data.closingSatang)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <footer className="statement-footer">
        <span>ยอดรับสะสม = ยอดยกมา + ยอดรับชำระยืนยันในช่วงวันที่เลือก</span>
        <span>รายงานภายใน CCIDA · ไม่ใช่เอกสารจากธนาคาร</span>
        <small>
          ไม่รวมรายการรอชำระ ยกเลิก คืนเงิน หรือเคลียร์ยอด · ยอดยกมาและยอดสะสมคำนวณจากสถานะปัจจุบัน
        </small>
        {(query || method !== 'ALL') && (
          <small>
            แสดง {rows.length} จาก {data.rows.length} รายการ ·
            ยอดรวมและยอดสะสมยังอ้างอิงทุกรายการในช่วงวันที่
          </small>
        )}
      </footer>
    </section>
  );
}
