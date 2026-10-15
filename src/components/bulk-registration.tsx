'use client';
import { useRef, useState } from 'react';
import { isRejectedSubmission, useApp } from './context';
import { Table } from './ui';
import { VipCardButton } from './vip-card-button';
import type { PrintDto } from './types';
import {
  bulkRegistrationSchema,
  isBulkRegistration,
  type BulkRegistration as BulkInput,
} from '@/lib/bulk-registration-schema';
import { usePersistentIntent } from './persistent-intent';
import { requestKey } from '@/lib/client-key';

type CreatedCustomer = { id: string; number: string; customerName: string; isVip: boolean };

export function BulkRegistration() {
  const app = useApp();
  const [opened, setOpened] = useState(false);
  const [preview, setPreview] = useState<BulkInput | null>(null);
  const [lastDraft, setLastDraft] = useState<BulkInput | null>(null);
  const [created, setCreated] = useState<CreatedCustomer[]>([]);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const [pending, persist, ready] = usePersistentIntent<BulkInput>(
    `ccida:bulk-registration:${app.user.id}:${app.eventId}`,
    isBulkRegistration,
  );
  const draft = pending ?? preview;
  const disabled =
    app.busy ||
    !ready ||
    !app.stationId ||
    app.events.find((event) => event.id === app.eventId)?.status !== 'OPEN';

  return (
    <section className="panel">
      <button type="button" aria-expanded={opened || !!pending} onClick={() => setOpened(!opened)}>
        Bulk create customers / สร้างลูกค้าหลายคน
      </button>
      {(opened || pending) && (
        <>
          <h2>Bulk create Normal or VIP customers</h2>
          <p>
            Choose a customer type and paste one name per line, up to 100 customers. Each gets a
            separate account and QR code. Group and table apply to everyone in this batch.
          </p>
          {!draft ? (
            <form
              className="editor"
              onSubmit={(event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                const result = bulkRegistrationSchema.safeParse({
                  eventId: app.eventId,
                  stationId: app.stationId,
                  key: requestKey(),
                  isVip: values.get('isVip') === 'true',
                  names: String(values.get('names'))
                    .split(/\r?\n/)
                    .map((name) => name.trim())
                    .filter(Boolean),
                  group: values.get('group'),
                  tableNumber: values.get('tableNumber'),
                });
                if (!result.success) {
                  setError('Enter 1–100 names, each up to 120 characters.');
                  return;
                }
                setError('');
                setPreview(result.data);
                setLastDraft(result.data);
                setCreated([]);
              }}
            >
              <label>
                Customer type / ประเภทลูกค้า
                <select
                  name="isVip"
                  defaultValue={String(lastDraft?.isVip ?? false)}
                  disabled={disabled}
                >
                  <option value="false">Normal / ลูกค้าทั่วไป</option>
                  <option value="true">VIP</option>
                </select>
              </label>
              <label>
                Customer names / ชื่อลูกค้า (one per line)
                <textarea
                  name="names"
                  rows={8}
                  maxLength={12200}
                  required
                  disabled={disabled}
                  defaultValue={lastDraft?.names.join('\n')}
                />
              </label>
              <label>
                Group / กลุ่ม (optional)
                <input
                  name="group"
                  maxLength={80}
                  disabled={disabled}
                  defaultValue={lastDraft?.group}
                />
              </label>
              <label>
                Table / โต๊ะ (optional)
                <input
                  name="tableNumber"
                  maxLength={30}
                  disabled={disabled}
                  defaultValue={lastDraft?.tableNumber}
                />
              </label>
              <button className="primary" disabled={disabled}>
                Review customers
              </button>
            </form>
          ) : (
            <>
              <p>
                <strong>
                  {draft.names.length} {draft.isVip ? 'VIP' : 'Normal'} customers
                </strong>{' '}
                · Group: {draft.group || '—'} · Table: {draft.tableNumber || '—'}
              </p>
              <ol>
                {draft.names.map((name, index) => (
                  <li key={index}>{name}</li>
                ))}
              </ol>
              {pending && (
                <p>
                  This batch is pending confirmation. Retry to check or complete the same batch
                  safely.
                </p>
              )}
              <div className="actions">
                <button
                  className="primary"
                  disabled={disabled}
                  onClick={async () => {
                    if (disabled || sending.current) return;
                    sending.current = true;
                    persist(draft);
                    try {
                      const result = await app.op<{ registrations: CreatedCustomer[] }>(
                        'registration.bulk.create',
                        draft,
                      );
                      setCreated(result.registrations);
                      persist(null);
                      setPreview(null);
                      setLastDraft(null);
                      app.notify(
                        `Created ${result.registrations.length} ${draft.isVip ? 'VIP' : 'Normal'} customers.`,
                      );
                    } catch (failure) {
                      if (isRejectedSubmission(failure)) persist(null);
                    } finally {
                      sending.current = false;
                    }
                  }}
                >
                  {pending ? 'Retry same batch' : `Create ${draft.names.length} customers`}
                </button>
                {!pending && (
                  <button disabled={app.busy} onClick={() => setPreview(null)}>
                    Back
                  </button>
                )}
              </div>
            </>
          )}
          {error && <p role="alert">{error}</p>}
          {!!created.length && (
            <>
              <p role="status">Created {created.length} customers. Print their QR cards below.</p>
              {created[0].isVip &&
                ['SUPER_ADMIN', 'REGISTRATION_CASHIER'].includes(app.user.roleName) && (
                  <VipCardButton registrationIds={created.map((row) => row.id)} />
                )}
              <Table
                rows={created}
                columns={[
                  { label: 'Registration', render: (row) => row.number },
                  { label: 'Customer', render: (row) => row.customerName },
                  { label: 'Type', render: (row) => (row.isVip ? 'VIP' : 'Normal') },
                  {
                    label: 'QR card',
                    render: (row) => (
                      <button
                        disabled={app.busy}
                        onClick={async () => {
                          try {
                            app.print(
                              await app.op<PrintDto>('qr.print', { registrationId: row.id }),
                            );
                          } catch {
                            /* Application notice retains the error. */
                          }
                        }}
                      >
                        Print QR
                      </button>
                    ),
                  },
                ]}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
