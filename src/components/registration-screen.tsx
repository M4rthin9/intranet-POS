'use client';
import { useEffect, useState } from 'react';
import { api, useApp } from './context';
import { Editor, Table, Badge, Confirm, type Field } from './ui';
import type { RegistrationDto, PrintDto } from './types';
import { VipCardButton } from './vip-card-button';
const fields: Field[] = [
  {
    name: 'isVip',
    label: 'ประเภทบัตร',
    type: 'select',
    defaultValue: 'false',
    options: [
      { value: 'false', label: 'ลูกค้าทั่วไป · QR ปกติ' },
      { value: 'true', label: 'VIP · Welcome card / PDF / PNG / JPG' },
    ],
  },
  { name: 'customerName', label: 'ชื่อผู้ร่วมงาน' },
  { name: 'phone', label: 'โทรศัพท์ (ไม่บังคับ)', required: false },
  { name: 'group', label: 'กลุ่ม', required: false },
  { name: 'tableNumber', label: 'โต๊ะ', required: false },
  { name: 'guestCount', label: 'จำนวนผู้ร่วมงาน', type: 'number', min: 1, defaultValue: 1 },
  { name: 'notes', label: 'หมายเหตุ', type: 'textarea', required: false },
];
export function RegistrationScreen() {
  const { eventId } = useApp();
  return <EventRegistrationScreen key={eventId} />;
}
function EventRegistrationScreen() {
  const app = useApp();
  const { eventId, revision, notify } = app;
  const [rows, setRows] = useState<RegistrationDto[]>([]);
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<RegistrationDto | null>(null);
  const [history, setHistory] = useState<RegistrationDto | null>(null);
  const [customerType, setCustomerType] = useState('all');
  const [selection, setSelection] = useState<{ eventId: string; ids: string[] }>({
    eventId: '',
    ids: [],
  });
  const canPrintVip = ['SUPER_ADMIN', 'REGISTRATION_CASHIER'].includes(app.user.roleName);
  const visibleRows = rows.filter(
    (row) => customerType === 'all' || (customerType === 'vip' ? row.isVip : !row.isVip),
  );
  const eligibleIds = visibleRows
    .filter(
      (row) =>
        row.isVip &&
        ['ACTIVE', 'SETTLED'].includes(row.account.status) &&
        row.account.credentials.some((credential) => !credential.revokedAt),
    )
    .map((row) => row.id);
  const selectedIds =
    selection.eventId === eventId ? selection.ids.filter((id) => eligibleIds.includes(id)) : [];
  useEffect(() => {
    if (!eventId) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<RegistrationDto[]>(
        `/api/data?view=registrations&eventId=${eventId}&search=${encodeURIComponent(search)}&customerType=${customerType}`,
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
  }, [eventId, revision, search, customerType, notify]);
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
                    ...(edit.account.status === 'SETTLED'
                      ? []
                      : [
                          {
                            name: 'status',
                            label: 'สถานะ',
                            type: 'select',
                            options: ['ACTIVE', 'BLOCKED', 'CANCELLED', 'EXPIRED'].map((value) => ({
                              value,
                              label: value,
                            })),
                          } as Field,
                        ]),
                    { name: 'reason', label: 'เหตุผลการแก้ไข' },
                  ]
                : fields
            }
            initial={edit ? { ...edit, status: edit.account.status } : {}}
            busy={
              app.busy ||
              !app.stationId ||
              app.events.find((event) => event.id === eventId)?.status !== 'OPEN'
            }
            resetOnSuccess={!edit}
            onSave={async (values) => {
              if (edit) {
                await app.op('registration.update', {
                  ...values,
                  isVip: values.isVip === 'true',
                  id: edit.id,
                });
                setEdit(null);
              } else {
                const result = await app.op<PrintDto>('registration.create', {
                  ...values,
                  isVip: values.isVip === 'true',
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
        <div className="actions">
          <label>
            ประเภทลูกค้า{' '}
            <select
              aria-label="Customer type filter"
              value={customerType}
              onChange={(event) => setCustomerType(event.target.value)}
            >
              <option value="all">ทั้งหมด / All</option>
              <option value="normal">ลูกค้าทั่วไป / Normal</option>
              <option value="vip">VIP</option>
            </select>
          </label>
          {canPrintVip && (
            <>
              <button
                disabled={app.busy || !eligibleIds.length}
                onClick={() => setSelection({ eventId, ids: eligibleIds.slice(0, 100) })}
              >
                เลือก VIP ที่แสดง (สูงสุด 100)
              </button>
              <button
                disabled={!selectedIds.length}
                onClick={() => setSelection({ eventId, ids: [] })}
              >
                ล้างการเลือก
              </button>
              <VipCardButton registrationIds={selectedIds} />
            </>
          )}
        </div>
        {canPrintVip && (
          <p>
            เลือก VIP จากรายการที่แสดงเพื่อดาวน์โหลด PDF A4 · 10 บัตรต่อหน้า · บัตรละ 86 × 54 มม. ·
            พิมพ์ขนาดจริง 100%
          </p>
        )}
        <Table
          rows={visibleRows}
          columns={[
            ...(canPrintVip
              ? [
                  {
                    label: 'เลือก VIP',
                    render: (r: RegistrationDto) => (
                      <input
                        type="checkbox"
                        aria-label={`Select VIP ${r.number}`}
                        style={{ width: 'auto' }}
                        disabled={
                          !eligibleIds.includes(r.id) ||
                          app.busy ||
                          (!selectedIds.includes(r.id) && selectedIds.length >= 100)
                        }
                        checked={selectedIds.includes(r.id)}
                        onChange={(event) =>
                          setSelection({
                            eventId,
                            ids: event.target.checked
                              ? [...selectedIds, r.id]
                              : selectedIds.filter((id) => id !== r.id),
                          })
                        }
                      />
                    ),
                  },
                ]
              : []),
            { label: 'ทะเบียน', render: (r) => <strong>{r.number}</strong> },
            {
              label: 'ผู้ร่วมงาน',
              render: (r) => (
                <>
                  {r.customerName}
                  <Badge>{r.isVip ? 'VIP' : 'Normal'}</Badge>
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
                  {r.isVip && (
                    <VipCardButton
                      registrationId={r.id}
                      number={r.number}
                      disabled={!eligibleIds.includes(r.id)}
                    />
                  )}
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
