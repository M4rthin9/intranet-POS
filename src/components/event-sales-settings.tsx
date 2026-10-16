'use client';
import { useState } from 'react';
import { api, isRejectedSubmission, money, time, useApp } from './context';
import { requestKey } from '@/lib/client-key';
import { usePersistentIntent } from './persistent-intent';

type Preview = {
  event: { id: string; code: string; name: string };
  token: string;
  summary: {
    orders: number;
    payments: number;
    netSalesSatang: number;
    outstandingSatang: number;
    confirmedPaymentSatang: number;
  };
  history: { id: string; createdAt: string; reason: string; backupId: string }[];
};
type Intent = {
  eventId: string;
  eventCode: string;
  reason: string;
  key: string;
  previewToken: string;
  acknowledged: true;
};
function validIntent(value: unknown): value is Intent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    ['eventId', 'eventCode', 'reason', 'key', 'previewToken'].every(
      (k) => typeof v[k] === 'string',
    ) && v.acknowledged === true
  );
}
export function EventSalesSettings() {
  const app = useApp();
  const [eventId, setEventId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [eventCode, setEventCode] = useState('');
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ clearId: string; backupId: string } | null>(null);
  const [intent, persist, ready] = usePersistentIntent<Intent>(
    `event-sales-clear:${app.user.id}`,
    validIntent,
  );
  async function loadPreview() {
    setLoading(true);
    setPreview(null);
    setResult(null);
    setEventCode('');
    setAcknowledged(false);
    try {
      setPreview(
        await api<Preview>('/api/operations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'event.sales.preview', input: { eventId } }),
        }),
      );
    } catch (error) {
      app.notify(error instanceof Error ? error.message : 'Preview failed.');
    } finally {
      setLoading(false);
    }
  }
  async function clearSales() {
    const request =
      intent ??
      (preview
        ? {
            eventId: preview.event.id,
            eventCode,
            reason,
            key: requestKey(),
            previewToken: preview.token,
            acknowledged: true as const,
          }
        : null);
    if (!request) return;
    persist(request);
    try {
      const value = await app.op<{ clearId: string; backupId: string }>(
        'event.sales.clear',
        request,
      );
      persist(null);
      setPreview(null);
      setResult(value);
      setReason('');
      setEventCode('');
      setAcknowledged(false);
    } catch (error) {
      if (isRejectedSubmission(error)) {
        persist(null);
        setPreview(null);
      }
    }
  }
  const busy = loading || app.busy || !ready;
  return (
    <section className="panel event-sales-settings" aria-labelledby="clear-event-sales-heading">
      <h2 id="clear-event-sales-heading">ล้างยอดขายของงาน / Clear event sales</h2>
      <p>
        เริ่มยอดขายและยอดค้างชำระใหม่ โดยเก็บลูกค้า VIP / Normal และบัตร QR เดิมไว้ ระบบจะคืนสต็อก
        ปิดกะที่เปิดอยู่ และสำรองข้อมูลก่อนล้าง
      </p>
      <p>
        Reset sales totals and customer balances for one open event. Customers and QR cards stay
        usable. Sold stock is returned and open shifts are closed. Previous transactions remain
        archived in the database and audit log.
      </p>
      {intent ? (
        <div role="alert">
          <p>
            A previous clear request needs its result checked. Retry the same request for event code{' '}
            <strong>{intent.eventCode}</strong>.
          </p>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => void clearSales()}
          >
            Retry clear request
          </button>
        </div>
      ) : (
        <>
          <label>
            Event to clear
            <select
              aria-label="Event to clear"
              value={eventId}
              disabled={busy}
              onChange={(e) => {
                setEventId(e.target.value);
                setPreview(null);
                setResult(null);
              }}
            >
              <option value="">Select an open event</option>
              {app.events
                .filter((e) => e.status === 'OPEN')
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.code} · {e.name}
                  </option>
                ))}
            </select>
          </label>
          <button type="button" disabled={busy || !eventId} onClick={() => void loadPreview()}>
            Preview sales to clear
          </button>
          {preview && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void clearSales();
              }}
            >
              <h3>
                {preview.event.code} · {preview.event.name}
              </h3>
              <dl>
                <dt>Orders / payments to archive</dt>
                <dd>
                  {preview.summary.orders} / {preview.summary.payments}
                </dd>
                <dt>Sales</dt>
                <dd>{money(preview.summary.netSalesSatang)}</dd>
                <dt>Customer balances</dt>
                <dd>{money(preview.summary.outstandingSatang)}</dd>
                <dt>Confirmed payments</dt>
                <dd>{money(preview.summary.confirmedPaymentSatang)}</dd>
              </dl>
              <p role="note">
                A verified database backup is required before this reset. This clears POS records
                only; money already received is not refunded through the bank. Closed event reports
                cannot be reset.
              </p>
              <label>
                Type event code {preview.event.code}
                <input
                  required
                  autoComplete="off"
                  value={eventCode}
                  disabled={busy}
                  onChange={(e) => setEventCode(e.target.value)}
                />
              </label>
              <label>
                Reason for clearing
                <textarea
                  required
                  minLength={3}
                  maxLength={500}
                  value={reason}
                  disabled={busy}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={busy}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />{' '}
                I understand this resets totals and balances and does not refund bank payments.
              </label>
              <button
                type="submit"
                className="danger"
                disabled={
                  busy ||
                  eventCode !== preview.event.code ||
                  reason.trim().length < 3 ||
                  !acknowledged ||
                  (!preview.summary.orders && !preview.summary.payments)
                }
              >
                Back up and clear event sales
              </button>
              {preview.history.length > 0 && (
                <details>
                  <summary>Previous resets</summary>
                  {preview.history.map((h) => (
                    <p key={h.id}>
                      {time(h.createdAt)} · {h.reason} · Backup {h.backupId}
                    </p>
                  ))}
                </details>
              )}
            </form>
          )}
        </>
      )}
      {loading && <p role="status">Loading preview…</p>}
      {app.busy && <p role="status">Creating backup and processing request…</p>}
      {result && (
        <p role="status">
          Event sales cleared. Customers and QR cards kept. Backup: {result.backupId}. Audit
          reference: {result.clearId}.
        </p>
      )}
    </section>
  );
}
