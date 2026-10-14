'use client';
import { useEffect, useState } from 'react';
import { api, useApp, time } from './context';
import { Table, Editor } from './ui';
type BackupDto = {
  id: string;
  name: string;
  sha256: string;
  size: number;
  createdAt: string;
  reason: string;
};
export function BackupScreen() {
  const app = useApp();
  const { revision, notify } = app;
  const [rows, setRows] = useState<BackupDto[]>([]);
  const [localRevision, setLocalRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [schedule, setSchedule] = useState<Record<string, unknown>>({
    enabled: false,
    intervalHours: 24,
  });
  useEffect(() => {
    Promise.all([
      api<BackupDto[]>('/api/backup'),
      api<Record<string, unknown> | null>('/api/data?view=backup-schedule'),
    ])
      .then(([r, s]) => {
        setRows(r);
        if (s) setSchedule(s);
      })
      .catch((e) => notify(e.message));
  }, [revision, localRevision, notify]);
  return (
    <>
      <div className="split">
        <section className="panel">
          <h2>สำรองฐานข้อมูลส่วนกลาง</h2>
          <p>PostgreSQL custom archive · ตรวจสอบ SHA-256 · เก็บทั้งธุรกรรมและ audit</p>
          <Editor
            fields={[{ name: 'reason', label: 'เหตุผลการสำรอง' }]}
            busy={busy}
            label="สร้างข้อมูลสำรอง"
            onSave={async (values) => {
              setBusy(true);
              try {
                await api('/api/backup', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(values),
                });
                setLocalRevision((n) => n + 1);
                notify('สำรองข้อมูลสำเร็จ');
              } catch (e) {
                notify((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </section>
        <section className="panel">
          <h2>กำหนดสำรองตามเวลา</h2>
          <Editor
            key={String(schedule.enabled) + String(schedule.intervalHours)}
            fields={[
              {
                name: 'enabled',
                label: 'เปิดใช้งาน',
                type: 'select',
                options: [
                  { value: 'false', label: 'ปิด' },
                  { value: 'true', label: 'เปิด' },
                ],
              },
              {
                name: 'intervalHours',
                label: 'ทุกกี่ชั่วโมง',
                type: 'number',
                min: 1,
                defaultValue: 24,
              },
            ]}
            initial={schedule}
            busy={app.busy}
            onSave={async (values) => {
              await app.op('backup.schedule', { ...values, enabled: values.enabled === 'true' });
            }}
          />
          <p>ต้องให้ backup worker ทำงาน · คำขอหลังปิดกิจกรรมจะทำงานแยกจากตารางนี้</p>
          <p>
            การกู้คืนใช้คำสั่งผู้ดูแลระบบและฐานข้อมูลใหม่ที่ว่างเท่านั้น ดูคู่มือ Backup / Restore
          </p>
        </section>
      </div>
      <section className="panel">
        <Table
          rows={rows}
          columns={[
            {
              label: 'เวลา / เหตุผล',
              render: (b) => (
                <>
                  {time(b.createdAt)}
                  <small>{b.reason}</small>
                </>
              ),
            },
            { label: 'ขนาด', render: (b) => `${(b.size / 1024).toFixed(1)} KB` },
            {
              label: 'ตรวจสอบ',
              render: (b) => (
                <details>
                  <summary>SHA-256</summary>
                  <code>{b.sha256}</code>
                </details>
              ),
            },
            {
              label: 'ดาวน์โหลด',
              render: (b) => (
                <a className="button" href={`/api/backup?id=${b.id}`}>
                  Download archive
                </a>
              ),
            },
          ]}
        />
      </section>
    </>
  );
}
