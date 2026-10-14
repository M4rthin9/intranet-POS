'use client';
import { requestKey } from '../lib/client-key';
import { useEffect, useState } from 'react';
import { api, useApp, money, time } from './context';
import { Table, Badge, Confirm } from './ui';
import type { OrderDto, PaymentDto, RegistrationDto } from './types';
type AuditDto = {
  id: string;
  createdAt: string;
  actorUserId: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  reason: string | null;
};
export function ControlsScreen({ auditOnly = false }: { auditOnly?: boolean }) {
  const app = useApp();
  const { eventId, revision, notify } = app;
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [payments, setPayments] = useState<PaymentDto[]>([]);
  const [registrations, setRegistrations] = useState<RegistrationDto[]>([]);
  const [logs, setLogs] = useState<AuditDto[]>([]);
  const [search, setSearch] = useState('');
  const [allEvents, setAllEvents] = useState(false);
  useEffect(() => {
    if (!eventId && !allEvents) return;
    const controller = new AbortController();
    api<AuditDto[]>(
      `/api/data?view=audit${allEvents ? '' : `&eventId=${eventId}`}&search=${encodeURIComponent(search)}`,
      { signal: controller.signal },
    )
      .then(setLogs)
      .catch((e) => {
        if (!controller.signal.aborted) notify(e.message);
      });
    if (!auditOnly)
      Promise.all([
        api<OrderDto[]>(`/api/data?view=orders&eventId=${eventId}`),
        api<PaymentDto[]>(`/api/data?view=payments&eventId=${eventId}`),
        api<RegistrationDto[]>(`/api/data?view=registrations&eventId=${eventId}`),
      ])
        .then(([o, p, r]) => {
          setOrders(o);
          setPayments(p);
          setRegistrations(r);
        })
        .catch((e) => notify(e.message));
    return () => controller.abort();
  }, [eventId, revision, notify, search, auditOnly, allEvents]);
  return (
    <>
      {!auditOnly && (
        <>
          <section className="panel">
            <h2>ยกเลิกรายการขาย · เฉพาะผู้ดูแลระบบสูงสุด</h2>
            <Table
              rows={orders}
              columns={[
                { label: 'รายการ', render: (o) => o.number },
                { label: 'ยอด', render: (o) => money(o.totalSatang) },
                { label: 'สถานะ', render: (o) => <Badge>{o.status}</Badge> },
                {
                  label: 'ควบคุม',
                  render: (o) =>
                    o.status === 'RECORDED' ? (
                      <Confirm
                        title="VOID รายการ"
                        reasonRequired
                        onConfirm={async (reason) => {
                          await app.op('order.void', {
                            id: o.id,
                            reason,
                            key: requestKey(),
                          });
                        }}
                      />
                    ) : null,
                },
              ]}
            />
          </section>
          <section className="panel">
            <h2>ยกเลิกการชำระ · คืนยอดค้างโดยเก็บหลักฐานเดิม</h2>
            <Table
              rows={payments}
              columns={[
                { label: 'การชำระ', render: (p) => p.number },
                { label: 'ยอด', render: (p) => money(p.amountSatang) },
                { label: 'สถานะ', render: (p) => <Badge>{p.status}</Badge> },
                {
                  label: 'ควบคุม',
                  render: (p) =>
                    ['CONFIRMED', 'AWAITING_CONFIRMATION', 'PENDING'].includes(p.status) ? (
                      <Confirm
                        title="VOID การชำระ"
                        reasonRequired
                        onConfirm={async (reason) => {
                          await app.op('payment.void', {
                            id: p.id,
                            reason,
                            key: requestKey(),
                          });
                        }}
                      />
                    ) : null,
                },
              ]}
            />
          </section>
          <section className="panel">
            <h2>เปิดบัญชีที่ชำระแล้วใหม่</h2>
            <Table
              rows={registrations.filter((r) => r.account.status === 'SETTLED')}
              columns={[
                { label: 'ทะเบียน', render: (r) => r.number },
                { label: 'ผู้ร่วมงาน', render: (r) => r.customerName },
                {
                  label: 'ควบคุม',
                  render: (r) => (
                    <Confirm
                      title="เปิดบัญชีใหม่"
                      reasonRequired
                      onConfirm={async (reason) => {
                        await app.op('account.reopen', { accountId: r.account.id, reason });
                      }}
                    />
                  ),
                },
              ]}
            />
          </section>
        </>
      )}
      <section className="panel">
        <h2>บันทึกการตรวจสอบ</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={allEvents}
            onChange={(e) => setAllEvents(e.target.checked)}
          />{' '}
          ทั้งระบบ รวม LOGIN และ BACKUP
        </label>
        <input
          placeholder="ค้นหาการกระทำ / รหัสรายการ / เหตุผล"
          aria-label="ค้นหา audit"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Table
          rows={logs}
          columns={[
            { label: 'เวลา', render: (l) => time(l.createdAt) },
            { label: 'การกระทำ', render: (l) => <strong>{l.action}</strong> },
            {
              label: 'ผู้ปฏิบัติ',
              render: (l) => (
                <>
                  {l.actorRole}
                  <small>{l.actorUserId}</small>
                </>
              ),
            },
            {
              label: 'รายการ / เหตุผล',
              render: (l) => (
                <>
                  {l.entityType}
                  <small>{l.entityId}</small>
                  {l.reason}
                </>
              ),
            },
            {
              label: 'ข้อมูลก่อน / หลัง',
              render: (l) => (
                <details>
                  <summary>ตรวจสอบ</summary>
                  <pre>{JSON.stringify({ before: l.before, after: l.after }, null, 2)}</pre>
                </details>
              ),
            },
          ]}
        />
      </section>
    </>
  );
}
