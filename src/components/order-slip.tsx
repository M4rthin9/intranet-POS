'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Image from 'next/image';
import { api, money, time } from './context';
import { PrintPortal } from './print-portal';
import type { OrderSlipDto } from './types';

export function OrderSlip({
  orderId,
  eventId,
  onClose,
}: {
  orderId: string;
  eventId: string;
  onClose: () => void;
}) {
  const [value, setValue] = useState<OrderSlipDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paperHeight, setPaperHeight] = useState(220);
  const documentRef = useRef<HTMLElement>(null);
  const autoPrinted = useRef(false);
  const printing = useRef(false);
  const load = useCallback(
    (signal?: AbortSignal) =>
      api<OrderSlipDto>('/api/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'order.slip', input: { orderId, eventId } }),
        signal,
      }),
    [orderId, eventId],
  );
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setValue(result);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [load]);
  const measure = useCallback(() => {
    if (!documentRef.current) return;
    const height = (documentRef.current.getBoundingClientRect().height * 25.4) / 96;
    setPaperHeight(
      Math.max(80, Math.ceil(height + (window.matchMedia('print').matches ? 8 : 0) + 2)),
    );
  }, []);
  useLayoutEffect(() => {
    const element = documentRef.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [value, measure]);
  const prepare = useCallback(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(documentRef.current?.querySelectorAll('img') ?? []).map((img) => img.decode()),
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, []);
  useEffect(() => {
    if (!value || autoPrinted.current) return;
    let cancelled = false;
    prepare()
      .then(() => {
        if (cancelled || autoPrinted.current) return;
        autoPrinted.current = true;
        flushSync(measure);
        window.print();
      })
      .catch(() => {
        if (!cancelled) setError('เปิดหน้าพิมพ์ไม่สำเร็จ กรุณากดพิมพ์ใบรายการซื้ออีกครั้ง');
      });
    return () => {
      cancelled = true;
    };
  }, [value, prepare, measure]);
  async function printAgain() {
    if (printing.current) return;
    printing.current = true;
    setBusy(true);
    setError('');
    try {
      const fresh = await load();
      // The manual action handles this print, including recovery after a failed preview.
      autoPrinted.current = true;
      flushSync(() => setValue(fresh));
      await prepare();
      flushSync(measure);
      window.print();
    } catch (failure) {
      setValue(null);
      setError(failure instanceof Error ? failure.message : 'พิมพ์ไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally {
      printing.current = false;
      setBusy(false);
    }
  }
  return (
    <PrintPortal>
      <style media="print">{`@page receipt { size: 80mm ${paperHeight}mm; margin: 4mm; }`}</style>
      <div className="print-overlay receipt-print-overlay" role="dialog" aria-label="ใบรายการซื้อ">
        <div className="print-actions">
          <button
            autoFocus
            className="primary"
            disabled={busy || (!value && !error)}
            onClick={printAgain}
          >
            {busy ? 'กำลังเตรียมพิมพ์…' : 'พิมพ์ใบรายการซื้อ 80 มม.'}
          </button>
          <button disabled={busy} onClick={onClose}>
            ปิด
          </button>
          <p>บันทึกการซื้อแล้ว · พิมพ์ซ้ำได้โดยไม่เพิ่มรายการขาย</p>
          <p>กระดาษ 80 มม. · ขนาดจริง 100% · ปิดหัว/ท้ายกระดาษ</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {!value && !error && <p role="status">กำลังเตรียมใบรายการซื้อ…</p>}
        </div>
        {value && (
          <article ref={documentRef} className="print-document receipt order-slip">
            {value.logoImage && (
              <Image
                unoptimized
                loading="eager"
                className="receipt-logo"
                src={value.logoImage}
                width={384}
                height={256}
                alt="Organization logo"
              />
            )}
            {value.header && <p className="receipt-message">{value.header}</p>}
            <h2>ใบรายการซื้อ / PURCHASE SLIP</h2>
            <p>
              <strong>ไม่ใช่ใบเสร็จรับเงิน</strong>
            </p>
            {value.copy && <p className="receipt-copy">สำเนา / COPY</p>}
            <dl className="receipt-meta">
              <div>
                <dt>เลขที่รายการ</dt>
                <dd>{value.number}</dd>
              </div>
              <div>
                <dt>กิจกรรม</dt>
                <dd>
                  {value.eventName} ({value.eventCode})
                </dd>
              </div>
              <div>
                <dt>ผู้ร่วมงาน</dt>
                <dd>{value.customerName}</dd>
              </div>
              <div>
                <dt>เลขทะเบียน</dt>
                <dd>{value.registrationNumber}</dd>
              </div>
              <div>
                <dt>จุดขาย / ผู้ขาย</dt>
                <dd>
                  {value.station} / {value.cashier}
                </dd>
              </div>
              <div>
                <dt>วันที่บันทึก</dt>
                <dd>{time(value.createdAt)}</dd>
              </div>
            </dl>
            <hr />
            <div className="receipt-line receipt-column-head">
              <span>สินค้า / จำนวน × ราคา</span>
              <span>รวม (บาท)</span>
            </div>
            {value.items.map((item) => (
              <div className="receipt-line" key={item.id}>
                <span>
                  {item.productNameSnapshot}
                  <small>
                    {item.quantity} × {money(item.unitPriceSatang)}
                  </small>
                </span>
                <span>{money(item.lineTotalSatang)}</span>
              </div>
            ))}
            <hr />
            <div className="receipt-line total">
              <strong>ยอดรายการนี้</strong>
              <strong>{money(value.totalSatang)}</strong>
            </div>
            <p>
              <strong>
                {value.status === 'PAID' ? 'รายการนี้ชำระแล้ว' : 'รอชำระเงินที่จุดชำระเงิน'}
              </strong>
            </p>
            <div className="order-slip-qr">
              <Image
                unoptimized
                loading="eager"
                src={value.qrImage}
                width={480}
                height={480}
                alt={`Purchase slip QR ${value.number}`}
              />
              <p>
                แสดง QR นี้ที่จุดชำระเงิน
                <br />
                เพื่อตรวจสอบรายการซื้อและยอดคงค้างทั้งหมด
              </p>
            </div>
            <p className="receipt-dates">
              กรุณาเก็บใบรายการนี้ไว้สำหรับตรวจสอบ
              <br />
              ยอดที่ต้องชำระอาจรวมรายการซื้อจากจุดขายอื่น
              <br />
              QR นี้ไม่ใช่ QR โอนเงิน
              <br />
              พิมพ์: {time(value.printedAt)}
            </p>
          </article>
        )}
      </div>
    </PrintPortal>
  );
}
