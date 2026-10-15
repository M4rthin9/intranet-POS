'use client';
import Image from 'next/image';
import { useRef, useState } from 'react';
import {
  RECEIPT_LOGO_MAX_BYTES,
  RECEIPT_LOGO_MAX_WIDTH,
  RECEIPT_LOGO_MAX_HEIGHT,
} from '../lib/receipt-logo-limits';

async function prepareLogo(file: File) {
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error('กรุณาเลือกภาพ PNG, JPG หรือ WebP ขนาดไม่เกิน 10 MB');
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('ไม่สามารถอ่านภาพได้ กรุณาเลือกไฟล์ใหม่'));
    reader.readAsDataURL(file);
  });
  const image = new window.Image();
  image.src = source;
  await image.decode();
  let scale = Math.min(
    1,
    RECEIPT_LOGO_MAX_WIDTH / image.naturalWidth,
    RECEIPT_LOGO_MAX_HEIGHT / image.naturalHeight,
  );
  const canvas = document.createElement('canvas');
  for (let attempt = 0; attempt < 6; attempt++) {
    canvas.width = Math.max(1, Math.floor(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.floor(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('ไม่สามารถเตรียมภาพโลโก้ได้');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL('image/png');
    if (atob(png.slice('data:image/png;base64,'.length)).length <= RECEIPT_LOGO_MAX_BYTES)
      return png;
    scale *= 0.75;
  }
  throw new Error('ภาพมีรายละเอียดมากเกินไป กรุณาเลือกไฟล์โลโก้ที่เล็กลง');
}

export function ReceiptLogoEditor({
  value,
  busy,
  onSave,
}: {
  value: string;
  busy: boolean;
  onSave: (logo: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const actionLock = useRef(false);
  const blocked = busy || preparing || saving;
  return (
    <section className="panel receipt-logo-settings">
      <h2>โลโก้บนใบเสร็จ</h2>
      <p>โลโก้จะแสดงตรงกลางด้านบนใบเสร็จและสำเนา ระบบปรับขนาดให้พอดีกับกระดาษ 80 มม.</p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!dirty || blocked || actionLock.current) return;
          actionLock.current = true;
          setSaving(true);
          try {
            await onSave(draft);
            setDirty(false);
            setError('');
          } catch (failure) {
            setError(
              failure instanceof Error ? failure.message : 'บันทึกโลโก้ไม่สำเร็จ กรุณาลองใหม่',
            );
          } finally {
            actionLock.current = false;
            setSaving(false);
          }
        }}
      >
        <div className="receipt-logo-preview">
          {draft ? (
            <Image src={draft} width={384} height={192} unoptimized alt="ตัวอย่างโลโก้ใบเสร็จ" />
          ) : (
            <span>ยังไม่มีโลโก้ · แสดงชื่อหน่วยงานบนใบเสร็จ</span>
          )}
        </div>
        <label>
          อัปโหลดโลโก้ใบเสร็จ
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={blocked}
            onChange={async (event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (!file) return;
              setPreparing(true);
              try {
                setDraft(await prepareLogo(file));
                setDirty(true);
                setError('');
              } catch (failure) {
                setError(
                  failure instanceof Error
                    ? failure.message
                    : 'ไม่สามารถอ่านภาพได้ กรุณาเลือกไฟล์ใหม่',
                );
              } finally {
                setPreparing(false);
              }
            }}
          />
        </label>
        <small>PNG, JPG หรือ WebP ไม่เกิน 10 MB · แนะนำโลโก้สีเข้มบนพื้นขาวหรือโปร่งใส</small>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="receipt-logo-editor-actions">
          <button className="primary" disabled={blocked || !dirty}>
            {preparing ? 'กำลังเตรียมภาพ…' : 'บันทึกโลโก้'}
          </button>
          <button
            type="button"
            disabled={blocked || !draft}
            onClick={() => {
              setDraft('');
              setDirty(true);
              setError('');
            }}
          >
            นำโลโก้ออก
          </button>
        </div>
      </form>
    </section>
  );
}
