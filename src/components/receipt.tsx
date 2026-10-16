'use client';
import type { ReceiptDto } from './types';
import { time, useApp } from './context';
import { useState, useLayoutEffect, useRef, useCallback, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { PrintPortal } from './print-portal';
import Image from 'next/image';
export function Receipt({ receipt, onClose }: { receipt: ReceiptDto; onClose: () => void }) {
  const app = useApp();
  const [current, setCurrent] = useState(receipt);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(true);
  const autoPrinted = useRef(false);
  const s = current.snapshot;
  const layout = current.layout;
  const amount = (value: number) =>
    (value / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totalItems = s.orders.reduce(
    (sum, order) => sum + order.items.reduce((n, item) => n + item.quantity, 0),
    0,
  );
  const [printError, setPrintError] = useState('');
  const documentRef = useRef<HTMLElement>(null);
  const [paperHeight, setPaperHeight] = useState(200);
  const measurePaper = useCallback(() => {
    if (!documentRef.current) return;
    const height = (documentRef.current.getBoundingClientRect().height * 25.4) / 96;
    // Screen padding is the paper margin; print CSS moves it to @page instead.
    const margins = window.matchMedia('print').matches ? 8 : 0;
    setPaperHeight(Math.max(60, Math.ceil(height + margins + 2)));
  }, []);
  const prepare = useCallback(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(documentRef.current?.querySelectorAll('img') ?? []).map((image) => image.decode()),
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, []);
  useEffect(() => {
    let cancelled = false;
    prepare()
      .then(() => {
        if (cancelled || autoPrinted.current) return;
        autoPrinted.current = true;
        setAttempted(true);
        flushSync(measurePaper);
        window.print();
      })
      .catch((error) => {
        if (!cancelled)
          setPrintError(
            `เปิดหน้าพิมพ์ไม่สำเร็จ กรุณากดพิมพ์อีกครั้ง${error instanceof Error ? ' · ' + error.message : ''}`,
          );
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [prepare, measurePaper]);
  useLayoutEffect(() => {
    const element = documentRef.current;
    if (!element) return;
    const update = () => {
      const height = (element.getBoundingClientRect().height * 25.4) / 96;
      setPaperHeight(
        Math.max(60, Math.ceil(height + (window.matchMedia('print').matches ? 8 : 0) + 2)),
      );
    };
    const observer = new ResizeObserver(update);
    update();
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <PrintPortal>
      <style media="print">{`@page receipt { size: 80mm ${paperHeight}mm; margin: 4mm; }`}</style>
      <div className="print-overlay receipt-print-overlay">
        <div className="print-actions">
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                if (attempted) {
                  const next = await app.op<ReceiptDto>('receipt.print', {
                    paymentId: current.paymentId,
                  });
                  flushSync(() => setCurrent(next));
                }
                setAttempted(true);
                await prepare();
                flushSync(measurePaper);
                window.print();
                setPrintError('');
              } catch (error) {
                setPrintError(
                  `เครื่องพิมพ์ไม่พร้อมใช้งาน / Printer unavailable. กรุณาตรวจสอบแล้วพิมพ์ใหม่${error instanceof Error ? ' · ' + error.message : ''}`,
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            พิมพ์ใบเสร็จ 80 มม.
          </button>
          <button disabled={busy} onClick={onClose}>
            ปิด
          </button>
          <p>กระดาษ 80 มม. · ขนาดจริง 100% · ปิดหัว/ท้ายกระดาษ · พิมพ์สำเนาได้โดยไม่ชำระซ้ำ</p>
          {printError && (
            <p className="error" role="alert">
              {printError}
            </p>
          )}
        </div>
        <article ref={documentRef} className="print-document receipt">
          {layout.logoImage && (
            <Image
              className="receipt-logo"
              src={layout.logoImage}
              width={384}
              height={256}
              unoptimized
              loading="eager"
              alt={`${s.organization} logo`}
            />
          )}
          <h2>{s.organization}</h2>
          {layout.header && <p className="receipt-message">{layout.header}</p>}
          <h3>ใบรับชำระเงิน</h3>
          {current.copy && <h3 className="receipt-copy">สำเนา / COPY</h3>}
          <dl className="receipt-meta">
            <div>
              <dt>เลขที่ใบเสร็จ</dt>
              <dd>{s.number}</dd>
            </div>
            <div>
              <dt>ผู้รับชำระ</dt>
              <dd>{s.user}</dd>
            </div>
            <div>
              <dt>ทะเบียน</dt>
              <dd>{s.registrationNumber}</dd>
            </div>
            <div>
              <dt>ผู้ร่วมงาน</dt>
              <dd>{s.customerName}</dd>
            </div>
            <div>
              <dt>กิจกรรม</dt>
              <dd>
                {s.eventCode} · {s.event}
              </dd>
            </div>
          </dl>
          <hr />
          <div className="receipt-line receipt-column-head">
            <strong>รายการ</strong>
            <strong>จำนวนเงิน</strong>
          </div>
          {s.orders.map((o) => (
            <div key={o.number}>
              <p className="receipt-order">{o.number}</p>
              {o.items.map((i) => (
                <div className="receipt-line" key={i.id}>
                  <span>
                    {i.productNameSnapshot}
                    <small>
                      {i.quantity} × {amount(i.unitPriceSatang)}
                    </small>
                  </span>
                  <span>{amount(i.lineTotalSatang)}</span>
                </div>
              ))}
            </div>
          ))}
          <hr />
          <div className="receipt-line">
            <span>รวมรายการ</span>
            <span>{amount(s.amountSatang)}</span>
          </div>
          <div className="receipt-line total">
            <strong>ยอดชำระ (บาท)</strong>
            <strong>{amount(s.amountSatang)}</strong>
          </div>
          <div className="receipt-line">
            <span>
              ชำระผ่าน{' '}
              {s.method === 'CASH'
                ? 'เงินสด / Cash'
                : s.method === 'PROMPTPAY'
                  ? 'QR PromptPay'
                  : s.method}
            </span>
            <span>{amount(s.amountSatang)}</span>
          </div>
          {s.method === 'CASH' && s.cashReceivedSatang !== undefined && (
            <>
              <div className="receipt-line">
                <span>รับเงินสด / Cash received</span>
                <span>{amount(s.cashReceivedSatang)}</span>
              </div>
              <div className="receipt-line">
                <span>เงินทอน / Change</span>
                <span>{amount(s.changeSatang ?? 0)}</span>
              </div>
            </>
          )}
          <p className="receipt-reference">อ้างอิง: {s.reference}</p>
          <hr />
          <div className="receipt-line">
            <span>จำนวนสินค้ารวม</span>
            <span>{totalItems}</span>
          </div>
          {layout.footer && <p className="receipt-message">{layout.footer}</p>}
          <p className="receipt-dates">
            วันชำระ: {time(s.confirmedAt)}
            <br />
            วันพิมพ์: {time(current.printedAt)}
          </p>
          {layout.qrImage && (
            <div className="receipt-footer-qr">
              <Image
                unoptimized
                src={layout.qrImage}
                width={480}
                height={480}
                alt="Receipt footer QR"
              />
              {layout.qrLabel && <p>{layout.qrLabel}</p>}
            </div>
          )}
          <div className="receipt-barcode-block">
            <Image
              unoptimized
              className="receipt-barcode"
              src={layout.barcodeImage}
              width={layout.barcodeWidth}
              height={layout.barcodeHeight}
              alt={`Receipt barcode ${layout.barcodeValue}`}
            />
            <p>{layout.barcodeValue}</p>
            <small>สแกนบาร์โค้ดเพื่อพิมพ์สำเนา</small>
          </div>
          <hr />
          <div className="receipt-line total receipt-grand-total">
            <strong>ยอดรวมสุทธิ / Grand total (THB)</strong>
            <strong>{amount(s.amountSatang)}</strong>
          </div>
        </article>
      </div>
    </PrintPortal>
  );
}
