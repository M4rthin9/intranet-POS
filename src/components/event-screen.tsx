'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from './context';
import { Editor, Table, Badge, Confirm } from './ui';
import type { EventDto } from './types';

export function EventScreen() {
  const app = useApp();
  const router = useRouter();
  const [edit, setEdit] = useState<EventDto | null>(null);
  const [search, setSearch] = useState('');
  const rows = app.events.filter((event) =>
    `${event.code} ${event.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <section className="panel">
        <h2>{edit ? 'แก้ไขกิจกรรม' : 'ลงทะเบียนกิจกรรม'}</h2>
        <p>สร้างกิจกรรมก่อนลงทะเบียนผู้ร่วมงาน เพื่อเก็บรายการขายและสถิติแยกแต่ละงาน</p>
        <Editor
          key={edit?.id ?? 'new'}
          initial={edit ?? { status: 'DRAFT' }}
          busy={app.busy}
          resetOnSuccess={!edit}
          fields={[
            { name: 'code', label: 'รหัสกิจกรรม', maxLength: 40 },
            { name: 'name', label: 'ชื่อกิจกรรม', maxLength: 160 },
            {
              name: 'status',
              label: 'สถานะกิจกรรม',
              type: 'select',
              options: (edit?.status === 'OPEN' ? ['OPEN'] : ['DRAFT', 'OPEN']).map((value) => ({
                value,
                label: value === 'OPEN' ? 'เปิดใช้งาน' : 'ฉบับร่าง',
              })),
            },
          ]}
          onSave={async (values) => {
            await app.op('event.save', { ...values, ...(edit ? { id: edit.id } : {}) });
            setEdit(null);
          }}
        />
        {edit && (
          <button disabled={app.busy} onClick={() => setEdit(null)}>
            ยกเลิก
          </button>
        )}
      </section>
      <section className="panel">
        <h2>กิจกรรมและสถิติยอดขาย</h2>
        <input
          aria-label="ค้นหากิจกรรม"
          placeholder="ค้นหารหัส / ชื่อกิจกรรม"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Table
          rows={rows}
          columns={[
            { label: 'รหัสกิจกรรม', render: (event) => event.code },
            { label: 'ชื่อกิจกรรม', render: (event) => event.name },
            { label: 'สถานะ', render: (event) => <Badge>{event.status}</Badge> },
            {
              label: 'จัดการ',
              render: (event) => (
                <div className="event-actions">
                  {['DRAFT', 'OPEN'].includes(event.status) && (
                    <button disabled={app.busy} onClick={() => setEdit(event)}>
                      แก้ไข
                    </button>
                  )}
                  <button
                    disabled={app.busy}
                    onClick={async () => {
                      await app.selectEvent(event.id, 'analytics');
                      router.push('/dashboard');
                    }}
                  >
                    ดูสถิติยอดขาย
                  </button>
                  {event.status === 'OPEN' && (
                    <button
                      disabled={app.busy}
                      onClick={async () => {
                        try {
                          await app.selectEvent(event.id, 'operations');
                          router.push('/register');
                        } catch {
                          /* Application notice displays the shift or event conflict. */
                        }
                      }}
                    >
                      ลงทะเบียนผู้ร่วมงาน
                    </button>
                  )}
                  {event.status === 'OPEN' && (
                    <Confirm
                      title="ปิดกิจกรรม"
                      reasonRequired
                      onConfirm={async (reason) => {
                        await app.op('event.close', { eventId: event.id, reason });
                      }}
                    />
                  )}
                </div>
              ),
            },
          ]}
        />
        <p>กิจกรรมที่ปิดแล้วคงประวัติทะเบียน รายการขาย การชำระ และสถิติเดิม</p>
      </section>
    </>
  );
}
