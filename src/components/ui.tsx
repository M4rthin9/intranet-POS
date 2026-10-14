'use client';
import { useState } from 'react';
export type Field = {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'password' | 'textarea' | 'select';
  options?: { value: string; label: string }[];
  required?: boolean;
  min?: number;
  defaultValue?: string | number;
};
export function Editor({
  fields,
  onSave,
  label = 'บันทึก',
  busy = false,
  initial = {},
}: {
  fields: Field[];
  onSave: (value: Record<string, string | number>) => Promise<void>;
  label?: string;
  busy?: boolean;
  initial?: Record<string, unknown>;
}) {
  return (
    <form
      className="editor"
      onSubmit={async (e) => {
        e.preventDefault();
        const values = Object.fromEntries(new FormData(e.currentTarget)) as Record<
          string,
          string | number
        >;
        for (const f of fields) if (f.type === 'number') values[f.name] = Number(values[f.name]);
        try {
          await onSave(values);
        } catch {
          /* The application notice retains the server error. */
        }
      }}
    >
      {fields.map((f) => (
        <label key={f.name}>
          {f.label}
          {f.type === 'select' ? (
            <select
              name={f.name}
              defaultValue={String(initial[f.name] ?? f.defaultValue ?? '')}
              required={f.required !== false}
            >
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.type === 'textarea' ? (
            <textarea
              name={f.name}
              defaultValue={String(initial[f.name] ?? f.defaultValue ?? '')}
              maxLength={1000}
            />
          ) : (
            <input
              name={f.name}
              type={f.type ?? 'text'}
              defaultValue={String(initial[f.name] ?? f.defaultValue ?? '')}
              required={f.required !== false}
              min={f.min}
              maxLength={f.type === 'password' ? 256 : 200}
              autoComplete={f.type === 'password' ? 'new-password' : undefined}
            />
          )}
        </label>
      ))}
      <button className="primary" disabled={busy}>
        {label}
      </button>
    </form>
  );
}
export function Badge({ children }: { children: React.ReactNode }) {
  return <span className={`badge ${String(children).toLowerCase()}`}>{children}</span>;
}
export function Table<T extends { id: string }>({
  rows,
  columns,
}: {
  rows: T[];
  columns: { label: string; render: (row: T) => React.ReactNode }[];
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.label}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {columns.map((c) => (
                <td key={c.label}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <div className="empty">ยังไม่มีข้อมูล / No records</div>}
    </div>
  );
}
export function Confirm({
  title,
  onConfirm,
  reasonRequired = false,
}: {
  title: string;
  onConfirm: (reason: string) => Promise<void>;
  reasonRequired?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return opened ? (
    <div className="confirm">
      <p>{title}</p>
      {reasonRequired && (
        <label>
          เหตุผล
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={3}
            required
          />
        </label>
      )}
      <div className="actions">
        <button
          className="danger"
          disabled={busy || (reasonRequired && reason.length < 3)}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm(reason);
              setOpened(false);
            } catch {
              /* Preserve confirmation and application error notice. */
            } finally {
              setBusy(false);
            }
          }}
        >
          ยืนยัน
        </button>
        <button onClick={() => setOpened(false)}>ยกเลิก</button>
      </div>
    </div>
  ) : (
    <button onClick={() => setOpened(true)}>{title}</button>
  );
}
