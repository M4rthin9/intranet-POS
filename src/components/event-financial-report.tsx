'use client';
import { useEffect, useState } from 'react';
import { Printer, RefreshCw } from 'lucide-react';
import { api, money, time, useApp } from './context';
import type { EventFinancialReport } from '../lib/event-financial-report';
import './event-financial-report.css';

export function EventFinancialReportView() {
  const { eventId, revision } = useApp();
  const [data, setData] = useState<EventFinancialReport | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<EventFinancialReport>(`/api/reports?view=financial&eventId=${eventId}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) {
          setData(value);
          setError('');
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setData(null);
          setError(failure.message);
        }
      });
    return () => controller.abort();
  }, [eventId, revision, refresh]);
  if (!data)
    return (
      <div className="panel" role={error ? 'alert' : 'status'}>
        {error || 'กำลังจัดทำรายงานการเงินทั้งกิจกรรม…'}
        {error && <button onClick={() => setRefresh((n) => n + 1)}>ลองใหม่</button>}
      </div>
    );
  const methods = [
    'PROMPTPAY',
    'CASH',
    ...data.methods.filter((p) => !['PROMPTPAY', 'CASH'].includes(p.method)).map((p) => p.method),
  ].map((method) => ({
    method,
    count: 0,
    amountSatang: 0,
    ...data.methods.find((p) => p.method === method),
  }));
  const name = (method: string) =>
    method === 'PROMPTPAY'
      ? 'QR พร้อมเพย์ / PromptPay'
      : method === 'CASH'
        ? 'เงินสด / Cash'
        : method;
  return (
    <>
      <div className="finance-actions">
        <p>รายงานครบทั้งกิจกรรม · รวมทุกหมวดหมู่และสินค้าที่ขาย · พิมพ์ต่อเนื่องเป็นเอกสารเดียว</p>
        <button onClick={() => setRefresh((n) => n + 1)} aria-label="อัปเดตรายงาน">
          <RefreshCw size={16} />
        </button>
        <button
          className="primary"
          onClick={async () => {
            await document.fonts.ready;
            const title = document.title;
            document.title = `รายงานการเงิน-${data.event.code}`;
            try {
              window.print();
            } finally {
              document.title = title;
            }
          }}
        >
          <Printer size={17} /> พิมพ์รายงานรวม / บันทึก PDF
        </button>
      </div>
      <article className="event-finance" aria-label="รายงานสรุปการเงินทั้งกิจกรรม">
        <div className="finance-heading">
          <div>
            <span className="finance-eyebrow">CCIDA · EVENT FINANCIAL REPORT</span>
            <h2>รายงานสรุปการเงินกิจกรรม</h2>
            <p>สำหรับฝ่ายการเงินและผู้บริหาร</p>
          </div>
          <div className="finance-reference">
            <strong>{data.event.code}</strong>
            <span>ข้อมูล ณ {time(data.asOf)}</span>
            <span>หน่วยเงิน: บาท (THB)</span>
          </div>
        </div>
        <div className="finance-event">
          <strong>{data.event.name}</strong>
          <span>ขอบเขต: ทั้งกิจกรรม ตั้งแต่เริ่มบันทึกถึงเวลาจัดทำรายงาน</span>
        </div>
        <section className="finance-section">
          <div className="finance-section-title">
            <span>01</span>
            <h3>ภาพรวมกิจกรรม</h3>
            <small>EXECUTIVE SUMMARY</small>
          </div>
          <div className="finance-kpis">
            <div>
              <span>ยอดขายสุทธิทั้งหมด</span>
              <strong>{money(data.salesSatang)}</strong>
              <small>
                {data.orders.toLocaleString()} รายการขาย · {data.quantity.toLocaleString()} หน่วย
              </small>
            </div>
            <div>
              <span>รับชำระยืนยันแล้ว</span>
              <strong>{money(data.receivedSatang)}</strong>
              <small>{data.receipts.toLocaleString()} รายการรับชำระ</small>
            </div>
            <div>
              <span>ยอดค้างชำระ</span>
              <strong>{money(data.outstandingSatang)}</strong>
              <small>{data.outstandingAccounts.toLocaleString()} บัญชีที่ยังค้างชำระ</small>
            </div>
          </div>
          <div className={`finance-status ${data.reconciled ? 'is-balanced' : 'needs-review'}`}>
            <strong>{data.reconciled ? 'ยอดกระทบตรงกัน' : 'พบผลต่าง กรุณาตรวจสอบ'}</strong>
            <span>ยอดขายสุทธิ = รับชำระยืนยันแล้ว + ยอดค้างชำระ</span>
          </div>
          <p className="finance-note">
            ยอดขายก่อนยกเลิก {money(data.grossSalesSatang)} − ยกเลิกการขาย{' '}
            {money(data.voidOrderSatang)} ({data.voidOrders.toLocaleString()} รายการ) = ยอดขายสุทธิ{' '}
            {money(data.salesSatang)}
          </p>
        </section>
        <section className="finance-section">
          <div className="finance-section-title">
            <span>02</span>
            <h3>สรุปเงินรับแยกตามช่องทาง</h3>
            <small>PAYMENT METHODS</small>
          </div>
          <table>
            <thead>
              <tr>
                <th>ช่องทางรับชำระ</th>
                <th className="num">จำนวนรายการ</th>
                <th className="num">รับชำระสุทธิ (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {methods.map((row) => (
                <tr key={row.method}>
                  <td>{name(row.method)}</td>
                  <td className="num">{row.count.toLocaleString()}</td>
                  <td className="num">{money(row.amountSatang)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>รวมรับชำระยืนยันแล้ว</th>
                <td className="num">{data.receipts.toLocaleString()}</td>
                <td className="num">{money(data.receivedSatang)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="finance-note">
            เงินสดแสดงยอดรับสุทธิหลังหักเงินทอน · ไม่รวมการรับชำระที่รอยืนยัน ยกเลิก หรือคืนเงิน
          </p>
        </section>
        <section className="finance-section">
          <div className="finance-section-title">
            <span>03</span>
            <h3>สรุปยอดขายแยกตามหมวดหมู่</h3>
            <small>CATEGORY SUMMARY</small>
          </div>
          <table>
            <thead>
              <tr>
                <th>หมวดหมู่สินค้า</th>
                <th className="num">จำนวนหน่วย</th>
                <th className="num">ยอดขายสุทธิ (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {data.categories.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="num">{row.quantity.toLocaleString()}</td>
                  <td className="num">{money(row.amountSatang)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>รวมทุกหมวดหมู่</th>
                <td className="num">{data.quantity.toLocaleString()}</td>
                <td className="num">{money(data.categorySatang)}</td>
              </tr>
            </tfoot>
          </table>
          {!data.categories.length && <p className="finance-note">ยังไม่มีรายการขายในกิจกรรมนี้</p>}
        </section>
        <section className="finance-section finance-products">
          <div className="finance-section-title">
            <span>04</span>
            <h3>รายละเอียดสินค้าที่ขายทั้งหมด</h3>
            <small>PRODUCT SALES DETAIL</small>
          </div>
          <p className="finance-note">
            รวมการขายที่บันทึกแล้วและชำระแล้ว · ไม่รวมรายการยกเลิกหรือรายการที่ล้างออกจากยอดขาย ·
            แยกแถวเมื่อชื่อ หมวดหมู่ หรือราคาขณะขายต่างกัน
          </p>
          {data.categories.map((category) => (
            <div className="finance-product-group" key={category.label}>
              <h4>{category.label}</h4>
              <table>
                <thead>
                  <tr>
                    <th className="finance-code">รหัส</th>
                    <th>สินค้า</th>
                    <th className="num">ราคา/หน่วย</th>
                    <th className="num">จำนวน</th>
                    <th className="num">รวม (บาท)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.products
                    .filter((row) => row.category === category.label)
                    .map((row, index) => (
                      <tr key={index}>
                        <td className="finance-code">{row.code}</td>
                        <td>{row.name}</td>
                        <td className="num">{money(row.unitPriceSatang)}</td>
                        <td className="num">{row.quantity.toLocaleString()}</td>
                        <td className="num">{money(row.amountSatang)}</td>
                      </tr>
                    ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={3}>รวมหมวดหมู่ {category.label}</th>
                    <td className="num">
                      {data.products
                        .filter((row) => row.category === category.label)
                        .reduce((n, row) => n + row.quantity, 0)
                        .toLocaleString()}
                    </td>
                    <td className="num">
                      {money(
                        data.products
                          .filter((row) => row.category === category.label)
                          .reduce((n, row) => n + row.amountSatang, 0),
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ))}
          <div className="finance-grand-total">
            <strong>รวมสินค้าที่ขายทั้งกิจกรรม</strong>
            <span>{data.quantity.toLocaleString()} หน่วย</span>
            <strong>{money(data.productSatang)} บาท</strong>
          </div>
        </section>
        <section className="finance-section finance-reconciliation">
          <div className="finance-section-title">
            <span>05</span>
            <h3>ตรวจสอบความถูกต้องของยอดรวม</h3>
            <small>RECONCILIATION</small>
          </div>
          <table>
            <thead>
              <tr>
                <th>รายการตรวจสอบ</th>
                <th className="num">ผลต่าง (บาท)</th>
                <th className="num">ผลตรวจสอบ</th>
              </tr>
            </thead>
            <tbody>
              {data.checks.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="num">{money(row.differenceSatang)}</td>
                  <td className="num">{row.differenceSatang === 0 ? 'ตรงกัน' : 'ต้องตรวจสอบ'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="finance-note">
            ผลต่างทุกรายการควรเป็น 0.00 บาท · ยอดขายตามหมวดหมู่และสินค้าเป็นยอดขายสุทธิ
            รวมยอดที่ยังค้างชำระ ไม่ใช่เฉพาะเงินที่รับแล้ว
          </p>
          <div className="finance-signatures">
            <div>
              <span>ผู้จัดทำ / ฝ่ายการเงิน</span>
              <small>ลงชื่อ ____________________ วันที่ __________</small>
            </div>
            <div>
              <span>ผู้ตรวจสอบ / ผู้บริหาร</span>
              <small>ลงชื่อ ____________________ วันที่ __________</small>
            </div>
          </div>
        </section>
        <div className="finance-footer">
          <span>CCIDA · {data.event.code}</span>
          <span>รายงานจากระบบ ณ {time(data.asOf)} · เวลาไทย</span>
        </div>
      </article>
    </>
  );
}
