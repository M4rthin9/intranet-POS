'use client';
import { useEffect, useState } from 'react';
import { api, useApp } from './context';
import { Editor, Table, Badge, type Field } from './ui';
import { rolePages } from '../lib/role-pages';
import { ReceiptLogoEditor } from './receipt-logo-editor';
type Row = { id: string; [key: string]: unknown };
export function ManagementScreen({ view }: { view: 'users' | 'settings' }) {
  const app = useApp();
  const { revision, notify } = app;
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [search, setSearch] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api<Row[] | { organization: string }>(
      `/api/data?view=${view}&search=${encodeURIComponent(search)}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (Array.isArray(data)) setRows(data);
        else setEdit({ id: 'organization', ...data });
      })
      .catch((e) => {
        if (!controller.signal.aborted) notify(e.message);
      });
    return () => controller.abort();
  }, [view, revision, notify, search]);
  const fields: Field[] =
    view === 'users'
      ? [
          { name: 'username', label: 'ชื่อผู้ใช้งาน' },
          { name: 'displayName', label: 'ชื่อที่แสดง' },
          {
            name: 'roleName',
            label: 'บทบาท',
            type: 'select',
            options: Object.entries(rolePages).map(([value, config]) => ({
              value,
              label: config.label,
            })),
          },
          {
            name: 'password',
            label: 'รหัสผ่านใหม่ (อย่างน้อย 14 ตัวอักษร)',
            type: 'password',
            required: !edit,
          },
          {
            name: 'assignedEventId',
            label: 'กิจกรรมที่ผูกกับผู้ใช้งาน',
            type: 'select',
            required: false,
            options: [
              { value: '', label: 'ไม่ผูกกิจกรรม (สำหรับ Super Admin)' },
              ...app.events.map((event) => ({
                value: event.id,
                label: `${event.code} · ${event.name} · ${event.status}`,
              })),
            ],
          },
          {
            name: 'active',
            label: 'เปิดใช้งาน',
            type: 'select',
            options: [
              { value: 'true', label: 'ใช้งาน' },
              { value: 'false', label: 'ระงับ' },
            ],
          },
        ]
      : [
          { name: 'organization', label: 'ชื่อหน่วยงานบนใบเสร็จ' },
          { name: 'receiptHeader', label: 'ข้อความหัวใบเสร็จ', type: 'textarea', required: false },
          { name: 'receiptFooter', label: 'ข้อความท้ายใบเสร็จ', type: 'textarea', required: false },
          {
            name: 'receiptQrValue',
            label: 'ข้อมูล QR ท้ายใบเสร็จ (URL หรือข้อความ)',
            type: 'textarea',
            required: false,
          },
          {
            name: 'receiptQrLabel',
            label: 'คำอธิบาย QR ท้ายใบเสร็จ',
            required: false,
            maxLength: 80,
          },
        ];
  return (
    <>
      {view === 'settings' && edit && (
        <ReceiptLogoEditor
          key={String(edit.receiptLogo ?? '')}
          value={String(edit.receiptLogo ?? '')}
          busy={app.busy}
          onSave={async (logo) => {
            await app.op('settings.save', {
              organization: String(edit.organization),
              receiptLogo: logo,
            });
          }}
        />
      )}
      <section className="panel">
        <h2>{edit ? 'แก้ไขข้อมูล' : 'เพิ่มข้อมูล'}</h2>
        {view === 'settings' && (
          <p>
            ตั้งค่า QR ท้ายใบเสร็จเป็นลิงก์หรือข้อความสั้น เว้นว่างเพื่อซ่อน QR ·
            บาร์โค้ดเลขที่ใบเสร็จสร้างให้อัตโนมัติ
          </p>
        )}
        <Editor
          key={`${view}-${edit?.id ?? 'new'}`}
          fields={fields}
          initial={edit ?? {}}
          busy={app.busy}
          resetOnSuccess={!edit && view !== 'settings'}
          onSave={async (values) => {
            const payload: Record<string, unknown> = { ...values };
            if ('active' in payload) payload.active = payload.active === 'true';
            if ('assignedEventId' in payload)
              payload.assignedEventId = payload.assignedEventId || null;
            if (!payload.password) delete payload.password;
            if (edit && view !== 'settings') payload.id = edit.id;
            await app.op(view === 'users' ? 'user.save' : 'settings.save', payload);
            if (view === 'users') setSearch(String(payload.username));
            if (view !== 'settings') setEdit(null);
          }}
        />
        {edit && view !== 'settings' && <button onClick={() => setEdit(null)}>ยกเลิก</button>}
      </section>
      {view !== 'settings' && (
        <section className="panel">
          {view === 'users' && (
            <>
              <input
                aria-label="ค้นหาผู้ใช้งาน"
                placeholder="ค้นหาชื่อผู้ใช้งาน / ชื่อที่แสดง"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <small>แสดงสูงสุด 300 บัญชี · ใช้การค้นหาเพื่อดูบัญชีที่ต้องการ</small>
            </>
          )}
          <Table
            rows={rows}
            columns={[
              { label: 'รหัส', render: (r) => String(r.code ?? r.username ?? '') },
              { label: 'ชื่อ', render: (r) => String(r.name ?? r.displayName ?? '') },
              {
                label: 'สถานะ / บทบาท',
                render: (r) => <Badge>{String(r.status ?? r.roleName ?? r.type ?? '')}</Badge>,
              },
              {
                label: 'กิจกรรม',
                render: (r) => {
                  const event = r.assignedEvent as { code: string; name: string } | null;
                  return event ? `${event.code} · ${event.name}` : 'ยังไม่ผูกกิจกรรม';
                },
              },
              {
                label: 'จัดการ',
                render: (r) => (
                  <button disabled={app.busy} onClick={() => setEdit(r)}>
                    แก้ไข
                  </button>
                ),
              },
            ]}
          />
        </section>
      )}
    </>
  );
}
