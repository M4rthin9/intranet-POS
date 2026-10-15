'use client';
import { useEffect, useState } from 'react';
import { api, useApp, time } from './context';
import { Confirm } from './ui';
type ShiftDto = {
  id: string;
  userId: string;
  stationId: string;
  openedAt: string;
  closedAt: string | null;
};
export function ShiftBar() {
  const app = useApp();
  const { eventId, revision, notify } = app;
  const [shifts, setShifts] = useState<ShiftDto[]>([]);
  useEffect(() => {
    if (eventId)
      api<ShiftDto[]>(`/api/data?view=shifts&eventId=${eventId}`)
        .then(setShifts)
        .catch((e) => notify(e.message));
  }, [eventId, revision, notify]);
  const current = shifts.find(
    (s) => s.userId === app.user.id && s.stationId === app.stationId && !s.closedAt,
  );
  return (
    <div className="shift-bar">
      <span>{current ? `กะเปิดแล้ว · ${time(current.openedAt)}` : 'เปิดกะก่อนปฏิบัติงาน'}</span>
      {!current && (
        <button
          disabled={
            !eventId ||
            !app.stationId ||
            app.busy ||
            app.events.find((event) => event.id === eventId)?.status !== 'OPEN'
          }
          onClick={async () => {
            try {
              await app.op('shift.open', { eventId, stationId: app.stationId });
            } catch {
              /* Application notice displays the error. */
            }
          }}
        >
          เปิดกะ
        </button>
      )}
      {current && (
        <Confirm
          title="ปิดกะ"
          onConfirm={async () => {
            await app.op('shift.close', { id: current.id });
          }}
        />
      )}
    </div>
  );
}
