'use client';
import { useState, useRef } from 'react';
import { useApp } from './context';

export function VipCardButton({
  registrationId,
  number,
  registrationIds,
  disabled = false,
}: {
  registrationId?: string;
  number?: string;
  registrationIds?: string[];
  disabled?: boolean;
}) {
  const app = useApp();
  const [loading, setLoading] = useState(false);
  const [format, setFormat] = useState<'pdf' | 'png' | 'jpg'>('pdf');
  const batch = registrationIds !== undefined;
  const lock = useRef(false);
  if (!['SUPER_ADMIN', 'REGISTRATION_CASHIER'].includes(app.user.roleName)) return null;
  return (
    <span className="actions">
      {!batch && (
        <select
          aria-label="VIP card file format"
          value={format}
          disabled={disabled || loading || app.busy}
          onChange={(event) => setFormat(event.target.value as typeof format)}
        >
          <option value="pdf">PDF · 86 × 54 mm</option>
          <option value="png">PNG · 300 DPI</option>
          <option value="jpg">JPG · 300 DPI</option>
        </select>
      )}
      <button
        disabled={
          disabled ||
          loading ||
          app.busy ||
          (batch && (!registrationIds.length || registrationIds.length > 100))
        }
        onClick={async () => {
          if (lock.current) return;
          lock.current = true;
          setLoading(true);
          try {
            const response = await fetch('/api/vip-card', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(
                batch ? { registrationIds, format: 'pdf', a4: true } : { registrationId, format },
              ),
            });
            if (!response.ok) {
              const error = await response
                .json()
                .catch(() => ({ error: 'Incomplete server response. Please retry.' }));
              throw new Error(error.error ?? 'Cannot generate VIP card.');
            }
            const expectedType =
              batch || format === 'pdf'
                ? 'application/pdf'
                : format === 'png'
                  ? 'image/png'
                  : 'image/jpeg';
            if (!response.headers.get('content-type')?.startsWith(expectedType))
              throw new Error('Unexpected download response. Please retry.');
            const url = URL.createObjectURL(await response.blob());
            const link = document.createElement('a');
            link.href = url;
            link.download = batch
              ? `VIP-A4-${registrationIds.length}-cards.pdf`
              : `VIP-${number}.${format}`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            app.notify('ดาวน์โหลดบัตร VIP แล้ว · พิมพ์ขนาดจริง 86 × 54 มม. (100%)');
          } catch (error) {
            app.notify(error instanceof Error ? error.message : 'Cannot generate VIP card.');
          } finally {
            lock.current = false;
            setLoading(false);
          }
        }}
      >
        {loading
          ? 'กำลังสร้างไฟล์…'
          : batch
            ? `ดาวน์โหลด PDF A4 (${registrationIds.length} บัตร)`
            : 'ดาวน์โหลดบัตร VIP'}
      </button>
    </span>
  );
}
