'use client';
import { useEffect, useState } from 'react';
import { api, useApp } from './context';
import { Editor, Table, Badge, Confirm, type Field } from './ui';
import type { RegistrationDto, PrintDto } from './types';
const fields: Field[] = [
  { name: 'customerName', label: 'ชื่อผู้ร่วมงาน' },
  { name: 'phone', label: 'โทรศัพท์ (ไม่บังคับ)', required: false },
  { name: 'group', label: 'กลุ่ม', required: false },
  { name: 'tableNumber', label: 'โต๊ะ', required: false },
  { name: 'guestCount', label: 'จำนวนผู้ร่วมงาน', type: 'number', min: 1, defaultValue: 1 },
  { name: 'notes', label: 'หมายเหตุ', type: 'textarea', required: false },
];
export function RegistrationScreen() {
  const app = useApp();
  const { eventId, revision, notify } = app;
  const [rows, setRows] = useState<RegistrationDto[]>([]);
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<RegistrationDto | null>(null);
  const [history, setHistory] = useState<RegistrationDto | null>(null);
  useEffect(() => {
    if (!eventId) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<RegistrationDto[]>(
        `/api/data?view=registrations&eventId=${eventId}&search=${encodeURIComponent(search)}`,
        { signal: controller.signal },
      )
        .then(setRows)
        .catch((e) => {
          if (!controller.signal.aborted) notify(e.message);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [eventId, revision, search, notify]);
  return (
    <>
      <div className="split">
        <section className="panel">
          <h2>{edit ? 'แก้ไขทะเบียน' : 'ลงทะเบียนผู้ร่วมงาน'}</h2>
          <Editor
            key={edit?.id ?? 'new'}
            fields={
              edit
                ? [
                    ...fields,
                    {
                      name: 'status',
                      label: 'สถานะ',
                      type: 'select',
                      options: ['ACTIVE', 'BLOCKED', 'CANCELLED', 'EXPIRED'].map((value) => ({
                        value,
                        label: value,
                      })),
                    },
                    { name: 'reason', label: 'เหตุผลการแก้ไข' },
                  ]
                : fields
            }
            initial={edit ? { ...edit, status: edit.account.status } : {}}
            busy={app.busy}
            onSave={async (values) => {
              if (edit) {
                await app.op('registration.update', { ...values, id: edit.id });
                setEdit(null);
              } else {
                const result = await app.op<PrintDto>('registration.create', {
                  ...values,
                  eventId: app.eventId,
                  stationId: app.stationId,
                });
                app.print(result);
              }
            }}
          />
          {edit && <button onClick={() => setEdit(null)}>ยกเลิกการแก้ไข</button>}
        </section>
        <section className="panel">
          <h2>ซื้อหลายครั้ง · QR เดียว · ชำระก่อนออก</h2>
          <p>พิมพ์บัตร QR ให้ผู้ร่วมงาน ใช้บัตรเดิมทุกจุดขาย และจุดชำระเงิน</p>
          <p>การออก QR ใหม่จะยกเลิก QR เก่าโดยคงรายการซื้อทั้งหมดไว้</p>
          <input
            aria-label="ค้นหาทะเบียน"
            placeholder="ค้นหาชื่อ / เลขทะเบียน"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </section>
      </div>
      <section className="panel">
        <Table
          rows={rows}
          columns={[
            { label: 'ทะเบียน', render: (r) => <strong>{r.number}</strong> },
            {
              label: 'ผู้ร่วมงาน',
              render: (r) => (
                <>
                  {r.customerName}
                  <small>
                    {r.group} {r.tableNumber && `โต๊ะ ${r.tableNumber}`}
                  </small>
                </>
              ),
            },
            { label: 'สถานะ', render: (r) => <Badge>{r.account.status}</Badge> },
            {
              label: 'จัดการ QR',
              render: (r) => (
                <div className="actions">
                  <button
                    onClick={async () =>
                      app.print(await app.op<PrintDto>('qr.print', { registrationId: r.id }))
                    }
                  >
                    พิมพ์ QR
                  </button>
                  <button onClick={() => setEdit(r)}>แก้ไข</button>
                  <button onClick={() => setHistory(r)}>ประวัติ</button>
                  <Confirm
                    title="ระงับ QR"
                    reasonRequired
                    onConfirm={async (reason) => {
                      await app.op('qr.block', { registrationId: r.id, reason });
                    }}
                  />
                  <Confirm
                    title="ออก QR ใหม่"
                    reasonRequired
                    onConfirm={async (reason) =>
                      app.print(
                        await app.op<PrintDto>('qr.reissue', { registrationId: r.id, reason }),
                      )
                    }
                  />
                </div>
              ),
            },
          ]}
        />
      </section>
      {history && (
        <section className="panel">
          <h2>ประวัติ QR · {history.number}</h2>
          {history.account.credentials.map((c) => (
            <p key={c.id}>
              {c.issuedAt} <Badge>{c.revokedAt ? 'REVOKED' : 'ACTIVE'}</Badge>
            </p>
          ))}
          <button onClick={() => setHistory(null)}>ปิด</button>
        </section>
      )}
    </>
  );
}
