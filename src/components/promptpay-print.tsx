'use client';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ApiError, useApp } from './context';
import type { PromptPayPrintDto } from './types';
import { QrCard } from './qr-card';
import { PrintPortal } from './print-portal';

export function PromptPayPrint({
  value,
  onClose,
  onInvalid,
}: {
  value: PromptPayPrintDto;
  onClose: () => void;
  onInvalid: () => void;
}) {
  const app = useApp();
  const [current, setCurrent] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState(false);
  const documentRef = useRef<HTMLDivElement>(null);
  return (
    <PrintPortal>
      <div className="print-overlay qr-print-overlay">
        <div className="print-actions">
          <button
            autoFocus
            className="primary"
            disabled={busy || app.busy || invalid}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const fresh = await app.op<PromptPayPrintDto>('payment.qr.print', {
                  paymentId: current.paymentId,
                  stationId: app.stationId,
                });
                flushSync(() => setCurrent(fresh));
                await documentRef.current?.querySelector('img')?.decode();
                window.print();
              } catch (failure) {
                if (
                  failure instanceof ApiError &&
                  [400, 403, 404, 409, 422].includes(failure.status)
                ) {
                  setInvalid(true);
                  onInvalid();
                  setError(failure.message);
                } else
                  setError(
                    'เครื่องพิมพ์หรือเซิร์ฟเวอร์ไม่พร้อมใช้งาน / Printer unavailable. ตรวจสอบแล้วลองพิมพ์ใหม่',
                  );
              } finally {
                setBusy(false);
              }
            }}
          >
            พิมพ์ QR พร้อมเพย์ 80 มม.
          </button>
          <button disabled={busy || app.busy} onClick={onClose}>
            ปิด
          </button>
          <p>กระดาษ 80 มม. · ความยาว 120 มม. · ขนาดจริง 100% · ปิดหัว/ท้ายกระดาษ</p>
          <p>การพิมพ์ QR ยังไม่ใช่การยืนยันรับเงิน</p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </div>
        {!invalid && (
          <div ref={documentRef}>
            <QrCard kind="promptpay" {...current} />
          </div>
        )}
      </div>
    </PrintPortal>
  );
}
