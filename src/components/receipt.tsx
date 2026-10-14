'use client';
import type { ReceiptDto } from './types';
import { money, time } from './context';
import { useState } from 'react';
export function Receipt({ receipt, onClose }: { receipt: ReceiptDto; onClose: () => void }) {
  const s = receipt.snapshot;
  const [printError, setPrintError] = useState('');
  return (
    <div className="print-overlay">
      <div className="print-actions">
        <button
          className="primary"
          onClick={() => {
            try {
              window.print();
              setPrintError('');
            } catch {
              setPrintError(
                'เครื่องพิมพ์ไม่พร้อมใช้งาน / Printer unavailable. กรุณาตรวจสอบแล้วพิมพ์ใหม่',
              );
            }
          }}
        >
          พิมพ์ใบเสร็จ 58 มม.
        </button>
        <button onClick={onClose}>ปิด</button>
        <p>ตรวจสอบเครื่องพิมพ์ · หากพิมพ์ไม่สำเร็จสามารถพิมพ์สำเนาได้โดยไม่ชำระซ้ำ</p>
        {printError && (
          <p className="error" role="alert">
            {printError}
          </p>
        )}
      </div>
      <article className="print-document receipt">
        <h2>{s.organization}</h2>
        <p>{s.event}</p>
        <h3>ใบรับชำระเงิน</h3>
        {receipt.copy && <h3>สำเนา / COPY</h3>}
        <p>
          {s.number}
          <br />
          {s.registrationNumber} · {s.customerName}
        </p>
        <hr />
        {s.orders.map((o) => (
          <div key={o.number}>
            <p className="receipt-order">
              {o.number} · {o.station}
            </p>
            {o.items.map((i) => (
              <div className="receipt-line" key={i.id}>
                <span>
                  {i.productNameSnapshot} × {i.quantity}
                </span>
                <span>{money(i.lineTotalSatang)}</span>
              </div>
            ))}
          </div>
        ))}
        <hr />
        <div className="receipt-line total">
          <strong>ยอดชำระ</strong>
          <strong>{money(s.amountSatang)}</strong>
        </div>
        <p>
          {s.method} · {s.reference}
        </p>
        <p>
          {time(s.confirmedAt)}
          <br />
          ผู้รับชำระ: {s.user}
          <br />
          จุดบริการ: {s.station}
        </p>
        <hr />
        <p>ขอบคุณที่ร่วมกิจกรรม</p>
      </article>
    </div>
  );
}
