'use client';
import { useEffect, useState } from 'react';
import { api, useApp } from './context';
import { Editor } from './ui';
export function PromptPaySettings() {
  const app = useApp();
  const { revision, notify } = app;
  const [setting, setSetting] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    api<Record<string, unknown> | null>('/api/data?view=promptpay')
      .then(setSetting)
      .catch((e) => notify(e.message));
  }, [revision, notify]);
  return (
    <section className="panel">
      <h2>ตั้งค่าผู้รับเงินพร้อมเพย์</h2>
      <p>เฉพาะผู้ดูแลระบบสูงสุด · ใช้หมายเลขที่ลงทะเบียนรับเงินจริงกับธนาคาร</p>
      <Editor
        key={String(setting?.identifier ?? 'new')}
        fields={[
          {
            name: 'type',
            label: 'ประเภทพร้อมเพย์',
            type: 'select',
            options: [
              { value: 'PHONE', label: 'หมายเลขโทรศัพท์' },
              { value: 'TAX_ID', label: 'เลขประจำตัว / เลขภาษี' },
              { value: 'EWALLET', label: 'E-wallet ID' },
            ],
          },
          { name: 'identifier', label: 'หมายเลขผู้รับเงิน (ตัวเลขเท่านั้น)' },
          { name: 'displayName', label: 'ชื่อผู้รับเงิน' },
          {
            name: 'enabled',
            label: 'เปิดรับชำระ',
            type: 'select',
            options: [
              { value: 'false', label: 'ปิดใช้งาน' },
              { value: 'true', label: 'เปิดใช้งาน' },
            ],
          },
        ]}
        initial={setting ?? {}}
        busy={app.busy}
        onSave={async (v) => {
          await app.op('promptpay.save', { ...v, enabled: v.enabled === 'true' });
        }}
      />
    </section>
  );
}
