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
        <p>สรุปยอดขาย การรับชำระ และสินค้าที่ขายทั้งหมดในกิจกรรม</p>
        <button onClick={() => setRefresh((n) => n + 1)} aria-label="อัปเดตรายงาน">
          <RefreshCw size={16} />
          อัปเดตข้อมูล
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
            <h3>สรุปยอดเงิน</h3>
            <small>EXECUTIVE SUMMARY</small>
          </div>
          <div className="finance-kpis">
            <div className="finance-kpi-sales">
              <span>ยอดขายสุทธิทั้งหมด</span>
              <strong>{money(data.salesSatang)}</strong>
              <small>
                {data.orders.toLocaleString()} รายการขาย · {data.quantity.toLocaleString()} หน่วย
              </small>
            </div>
            <div className="finance-kpi-received">
              <span>รับชำระยืนยันแล้ว</span>
              <strong>{money(data.receivedSatang)}</strong>
              <small>{data.receipts.toLocaleString()} รายการรับชำระ</small>
            </div>
            <div className="finance-kpi-outstanding">
              <span>ยอดค้างชำระ</span>
              <strong>{money(data.outstandingSatang)}</strong>
              <small>{data.outstandingAccounts.toLocaleString()} บัญชีที่ยังค้างชำระ</small>
            </div>
          </div>
          <dl className="finance-sales-breakdown">
            <div>
              <dt>ยอดขายก่อนยกเลิก</dt>
              <dd>{money(data.grossSalesSatang)}</dd>
            </div>
            <div>
              <dt>ยกเลิกการขาย ({data.voidOrders.toLocaleString()} รายการ)</dt>
              <dd>{money(data.voidOrderSatang)}</dd>
            </div>
          </dl>
        </section>
        <div className="finance-summaries">
          <section className="finance-section">
            <div className="finance-section-title">
              <span>02</span>
              <h3>สรุปเงินรับแยกตามช่องทาง</h3>
              <small>PAYMENT METHODS</small>
            </div>
            <div
              className="finance-table-scroll"
              role="region"
              aria-label="ตารางช่องทางรับชำระ"
              tabIndex={0}
            >
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
            </div>
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
            <div
              className="finance-table-scroll"
              role="region"
              aria-label="ตารางยอดขายตามหมวดหมู่"
              tabIndex={0}
            >
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
            </div>
            {!data.categories.length && (
              <p className="finance-note">ยังไม่มีรายการขายในกิจกรรมนี้</p>
            )}
          </section>
        </div>
        <section className="finance-section finance-products">
          <div className="finance-section-title">
            <span>04</span>
            <h3>รายละเอียดสินค้าที่ขายทั้งหมด</h3>
            <small>PRODUCT SALES DETAIL</small>
          </div>
          <p className="finance-note">
            แสดงยอดขายสุทธิ รวมรายการที่ยังค้างชำระ · แยกตามหมวดหมู่และราคาขณะขาย
          </p>
          {data.categories.map((category) => (
            <div className="finance-product-group" key={category.label}>
              <h4>{category.label}</h4>
              <div
                className="finance-table-scroll"
                role="region"
                aria-label={`ตารางสินค้า ${category.label}`}
                tabIndex={0}
              >
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
            </div>
          ))}
          {!data.products.length && <p className="finance-empty">ยังไม่มีรายการขายในกิจกรรมนี้</p>}
          <div className="finance-grand-total">
            <strong>รวมสินค้าที่ขายทั้งกิจกรรม</strong>
            <span>{data.quantity.toLocaleString()} หน่วย</span>
            <strong>{money(data.productSatang)} บาท</strong>
          </div>
        </section>
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
        <div className="finance-footer">
          <span>CCIDA · {data.event.code}</span>
          <span>รายงานจากระบบ ณ {time(data.asOf)} · เวลาไทย</span>
        </div>
      </article>
    </>
  );
}
