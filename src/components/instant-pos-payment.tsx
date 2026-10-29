'use client';
import { useRef, useState } from 'react';
import Image from 'next/image';
import { requestKey } from '../lib/client-key';
import { isRejectedSubmission, money, useApp } from './context';
import { isConfirmIntent, type ConfirmIntent } from './intent-schemas';
import { usePersistentIntent } from './persistent-intent';
import { PosCheckoutDialog } from './pos-checkout-dialog';
import { Receipt } from './receipt';
import type { PaymentDto, ReceiptDto } from './types';

export function InstantPosPayment({
  payment,
  onPayment,
  onClose,
}: {
  payment: PaymentDto | null;
  onPayment: (payment: PaymentDto) => void;
  onClose: () => void;
}) {
  const app = useApp();
  const [intent, setIntent, ready] = usePersistentIntent<ConfirmIntent>(
    `ccida:pos-confirm:${app.user.id}:${app.eventId}:${app.stationId}`,
    isConfirmIntent,
  );
  const [cashReceived, setCashReceived] = useState('');
  const [reference, setReference] = useState('');
  const [verified, setVerified] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptDto | null>(null);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const received = /^\d{1,8}(\.\d{1,2})?$/.test(cashReceived)
    ? Math.round(Number(cashReceived) * 100)
    : 0;
  const cash = payment?.method === 'CASH';
  function close() {
    setCashReceived('');
    setReference('');
    setVerified(false);
    setError('');
    onClose();
  }
  async function print(paymentId: string) {
    // Fetch separately: printing can be retried without charging again.
    const next = await app.op<ReceiptDto>('receipt.print', { paymentId });
    setReceipt(next);
  }
  async function confirm() {
    if (lock.current || app.busy || !ready || (!payment && !intent)) return;
    lock.current = true;
    setError('');
    const payload = intent ?? {
      paymentId: payment!.id,
      stationId: app.stationId,
      key: requestKey(),
      reference: cash ? `CASH-${payment!.number}` : reference.trim(),
      evidence: cash ? 'Cash received at POS' : 'Bank transfer verified at POS',
      evidenceVerified: true as const,
      ...(cash ? { cashReceivedSatang: received } : {}),
    };
    setIntent(payload);
    try {
      const result = await app.op<{ payment: PaymentDto }>('payment.pos.confirm', payload);
      onPayment(result.payment);
      setIntent(null);
      await print(result.payment.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Payment failed. Retry the same payment.');
      if (isRejectedSubmission(cause)) setIntent(null);
    } finally {
      lock.current = false;
    }
  }
  return (
    <>
      <PosCheckoutDialog
        open={!receipt && (!!payment || !!intent)}
        titleId="pos-payment-title"
        locked={app.busy || !!intent}
        onClose={close}
      >
        <div className="pos-modal-heading">
          <h2 id="pos-payment-title">รับชำระเงินที่ POS</h2>
          <button
            className="pos-modal-close"
            disabled={app.busy || !!intent}
            onClick={close}
            aria-label="ปิดหน้ารับชำระเงิน"
          >
            ×
          </button>
        </div>
        <div className="pos-modal-body pos-instant-fields">
          {payment && (
            <>
              <p>
                {payment.number} · {payment.method}
              </p>
              <div className="pos-modal-sale">
                <span>ยอดชำระ</span>
                <strong>{money(payment.amountSatang)}</strong>
              </div>
              {payment.status !== 'CONFIRMED' && (
                <>
                  {payment.qrImage && (
                    <>
                      <p>{payment.displayName}</p>
                      <Image
                        className="pos-instant-qr"
                        src={payment.qrImage}
                        alt="PromptPay QR"
                        width={280}
                        height={280}
                        unoptimized
                      />
                    </>
                  )}
                  {cash ? (
                    <label>
                      รับเงินสด (บาท)
                      <input
                        data-checkout-focus
                        aria-label="รับเงินสด (บาท)"
                        type="text"
                        inputMode="decimal"
                        value={cashReceived}
                        disabled={app.busy || !!intent}
                        onChange={(event) => setCashReceived(event.target.value)}
                      />
                      <p>เงินทอน {money(Math.max(0, received - payment.amountSatang))}</p>
                    </label>
                  ) : (
                    <label>
                      เลขอ้างอิงธนาคาร
                      <input
                        data-checkout-focus
                        aria-label="เลขอ้างอิงธนาคาร"
                        value={reference}
                        maxLength={120}
                        disabled={app.busy || !!intent}
                        onChange={(event) => setReference(event.target.value)}
                      />
                    </label>
                  )}
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={verified}
                      disabled={app.busy || !!intent}
                      onChange={(event) => setVerified(event.target.checked)}
                    />
                    {cash ? 'ตรวจนับและรับเงินสดแล้ว' : 'ตรวจสอบเงินเข้าบัญชีธนาคารแล้ว'}
                  </label>
                </>
              )}
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {payment?.status === 'CONFIRMED' && !intent ? (
            <button
              className="primary"
              disabled={app.busy}
              onClick={async () => {
                try {
                  await print(payment.id);
                } catch (cause) {
                  setError((cause as Error).message);
                }
              }}
            >
              พิมพ์ใบเสร็จ
            </button>
          ) : (
            <button
              className="primary"
              disabled={
                !ready ||
                app.busy ||
                (!intent &&
                  (!verified ||
                    (cash
                      ? received < (payment?.amountSatang ?? Infinity)
                      : reference.trim().length < 3)))
              }
              onClick={confirm}
            >
              {intent ? 'ลองยืนยันรายการเดิมอีกครั้ง' : 'ยืนยันรับชำระและพิมพ์ใบเสร็จ'}
            </button>
          )}
          {!intent && <p>ปิดหน้าต่างแล้วสามารถเปิดรับชำระต่อจากรายการขายล่าสุด</p>}
        </div>
      </PosCheckoutDialog>
      {receipt && (
        <Receipt
          receipt={receipt}
          onClose={() => {
            setReceipt(null);
            close();
          }}
        />
      )}
    </>
  );
}
