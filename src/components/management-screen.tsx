'use client';
import { useEffect, useState } from 'react';
import { api, useApp } from './context';
import { Editor, Table, Badge, type Field } from './ui';
type Row = { id: string; [key: string]: unknown };
export function ManagementScreen({ view }: { view: 'events' | 'stations' | 'users' | 'settings' }) {
  const app = useApp();
  const { revision, notify } = app;
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Row | null>(null);
  useEffect(() => {
    api<Row[] | { organization: string }>(`/api/data?view=${view}`)
      .then((data) => {
        if (Array.isArray(data)) setRows(data);
        else setEdit({ id: 'organization', ...data });
      })
      .catch((e) => notify(e.message));
  }, [view, revision, notify]);
  const fields: Field[] =
    view === 'events'
      ? [
          { name: 'code', label: 'รหัสกิจกรรม' },
          { name: 'name', label: 'ชื่อกิจกรรม' },
          {
            name: 'status',
            label: 'สถานะ',
            type: 'select',
            options: ['DRAFT', 'OPEN'].map((value) => ({ value, label: value })),
          },
        ]
      : view === 'stations'
        ? [
            { name: 'code', label: 'รหัสจุดบริการ' },
            { name: 'name', label: 'ชื่อจุดบริการ' },
            {
              name: 'type',
              label: 'ประเภท',
              type: 'select',
              options: ['REGISTRATION', 'POS', 'PAYMENT', 'ADMIN'].map((value) => ({
                value,
                label: value,
              })),
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
        : view === 'users'
          ? [
              { name: 'username', label: 'ชื่อผู้ใช้งาน' },
              { name: 'displayName', label: 'ชื่อที่แสดง' },
              {
                name: 'roleName',
                label: 'บทบาท',
                type: 'select',
                options: ['SUPER_ADMIN', 'ADMIN', 'CASHIER', 'PAYMENT_CASHIER'].map((value) => ({
                  value,
                  label: value,
                })),
              },
              {
                name: 'password',
                label: 'รหัสผ่านใหม่ (อย่างน้อย 14 ตัวอักษร)',
                type: 'password',
                required: !edit,
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
          : [{ name: 'organization', label: 'ชื่อหน่วยงานบนใบเสร็จ' }];
  return (
    <>
      <section className="panel">
        <h2>{edit ? 'แก้ไขข้อมูล' : 'เพิ่มข้อมูล'}</h2>
        <Editor
          key={`${view}-${edit?.id ?? 'new'}`}
          fields={fields}
          initial={edit ?? {}}
          busy={app.busy}
          onSave={async (values) => {
            const payload: Record<string, unknown> = { ...values };
            if ('active' in payload) payload.active = payload.active === 'true';
            if (!payload.password) delete payload.password;
            if (edit && view !== 'settings') payload.id = edit.id;
            await app.op(
              view === 'events'
                ? 'event.save'
                : view === 'stations'
                  ? 'station.save'
                  : view === 'users'
                    ? 'user.save'
                    : 'settings.save',
              payload,
            );
            if (view !== 'settings') setEdit(null);
          }}
        />
        {edit && view !== 'settings' && <button onClick={() => setEdit(null)}>ยกเลิก</button>}
      </section>
      {view !== 'settings' && (
        <section className="panel">
          <Table
            rows={rows}
            columns={[
              { label: 'รหัส', render: (r) => String(r.code ?? r.username ?? '') },
              { label: 'ชื่อ', render: (r) => String(r.name ?? r.displayName ?? '') },
              {
                label: 'สถานะ / บทบาท',
                render: (r) => <Badge>{String(r.status ?? r.roleName ?? r.type ?? '')}</Badge>,
              },
              { label: 'จัดการ', render: (r) => <button onClick={() => setEdit(r)}>แก้ไข</button> },
            ]}
          />
        </section>
      )}
    </>
  );
}
