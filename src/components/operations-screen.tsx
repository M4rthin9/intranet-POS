'use client';
import { useEffect, useState } from 'react';
import { api, useApp, money, time } from './context';
import { Table, Editor, Badge, Confirm } from './ui';
import { useSummary } from './dashboard-screen';
import type { ProductDto } from './types';
type ShiftDto = {
  id: string;
  userId: string;
  stationId: string;
  openedAt: string;
  closedAt: string | null;
  station: { code: string };
  user: { displayName: string };
  summary: {
    orders: number;
    grossSalesSatang: number;
    netSalesSatang: number;
    voidOrders: number;
    confirmedPaymentSatang: number;
    outstandingImpactSatang: number;
  } | null;
};
type InventoryDto = {
  id: string;
  product: ProductDto;
  openingStock: number;
  soldQuantity: number;
  adjustments: number;
  remainingStock: number;
  movements: {
    id: string;
    createdAt: string;
    kind: string;
    quantity: number;
    reason: string;
    reference: string | null;
  }[];
};
export function ShiftsScreen() {
  const app = useApp();
  const { eventId, revision, notify } = app;
  const [rows, setRows] = useState<ShiftDto[]>([]);
  useEffect(() => {
    if (eventId)
      api<ShiftDto[]>(`/api/data?view=shifts&eventId=${eventId}`)
        .then(setRows)
        .catch((e) => notify(e.message));
  }, [eventId, revision, notify]);
  return (
    <section className="panel">
      <h2>กะปฏิบัติงานและสรุปการปิดกะ</h2>
      <Table
        rows={rows}
        columns={[
          {
            label: 'เจ้าหน้าที่ / จุดบริการ',
            render: (s) => (
              <>
                {s.user.displayName}
                <small>{s.station.code}</small>
              </>
            ),
          },
          {
            label: 'เปิด / ปิด',
            render: (s) => (
              <>
                {time(s.openedAt)}
                <small>{s.closedAt ? time(s.closedAt) : 'กำลังปฏิบัติงาน'}</small>
              </>
            ),
          },
          { label: 'สถานะ', render: (s) => <Badge>{s.closedAt ? 'CLOSED' : 'OPEN'}</Badge> },
          {
            label: 'สรุป',
            render: (s) =>
              s.summary ? (
                <details>
                  <summary>
                    {s.summary.orders} รายการ · {money(s.summary.grossSalesSatang)}
                  </summary>
                  <p>
                    หลัง VOID {money(s.summary.netSalesSatang)}
                    <br />
                    VOID {s.summary.voidOrders} รายการ
                    <br />
                    รับชำระยืนยัน {money(s.summary.confirmedPaymentSatang)}
                    <br />
                    ผลต่อยอดค้าง {money(s.summary.outstandingImpactSatang)}
                  </p>
                </details>
              ) : null,
          },
          {
            label: 'ควบคุม',
            render: (s) =>
              !s.closedAt ? (
                <Confirm
                  title="ปิดกะ"
                  reasonRequired={s.userId !== app.user.id}
                  onConfirm={async (reason) => {
                    await app.op('shift.close', { id: s.id, ...(reason ? { reason } : {}) });
                  }}
                />
              ) : null,
          },
        ]}
      />
      {app.user.roleName === 'SUPER_ADMIN' && (
        <a className="button" href={`/api/export?eventId=${eventId}&type=shifts`}>
          ส่งออกกะ CSV
        </a>
      )}
    </section>
  );
}
export function StockScreen() {
  const app = useApp();
  const { eventId, revision, notify } = app;
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [rows, setRows] = useState<InventoryDto[]>([]);
  const [action, setAction] = useState('stock.open');
  useEffect(() => {
    if (!eventId) return;
    Promise.all([
      api<ProductDto[]>(`/api/data?view=products&eventId=${eventId}`),
      api<InventoryDto[]>(`/api/data?view=stock&eventId=${eventId}`),
    ])
      .then(([p, r]) => {
        setProducts(p.filter((p) => p.trackStock));
        setRows(r);
      })
      .catch((e) => notify(e.message));
  }, [eventId, revision, notify]);
  return (
    <>
      <section className="panel">
        <h2>สต็อกแยกตามกิจกรรม</h2>
        <p>เปิดควบคุมสต็อกในหน้าสินค้าก่อน · คงเหลือ = ยอดเปิด − ขาย + ปรับปรุง</p>
        <div className="category-tabs">
          {[
            ['stock.open', 'กำหนดยอดเปิด'],
            ['stock.adjust', 'ปรับปรุงสต็อก'],
          ].map(([id, label]) => (
            <button
              key={id}
              className={action === id ? 'active' : ''}
              onClick={() => setAction(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <Editor
          key={action}
          fields={[
            {
              name: 'productId',
              label: 'สินค้า',
              type: 'select',
              options: products.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })),
            },
            {
              name: 'quantity',
              label: action === 'stock.open' ? 'ยอดเปิด' : 'จำนวนปรับ (+ เพิ่ม / − ลด)',
              type: 'number',
              min: action === 'stock.open' ? 0 : -1000000,
              defaultValue: 0,
            },
            { name: 'reason', label: 'เหตุผล' },
          ]}
          busy={app.busy}
          onSave={async (v) => {
            await app.op(action, { ...v, eventId });
          }}
        />
      </section>
      <section className="panel">
        <Table
          rows={rows}
          columns={[
            {
              label: 'สินค้า',
              render: (r) => (
                <>
                  {r.product.name}
                  <small>{r.product.code}</small>
                </>
              ),
            },
            { label: 'ยอดเปิด', render: (r) => r.openingStock },
            { label: 'ขายสุทธิ', render: (r) => r.soldQuantity },
            { label: 'ปรับปรุง', render: (r) => r.adjustments },
            {
              label: 'คงเหลือ',
              render: (r) => (
                <strong
                  className={r.remainingStock <= r.product.lowStockThreshold ? 'low-stock' : ''}
                >
                  {r.remainingStock}{' '}
                  {r.remainingStock <= r.product.lowStockThreshold ? '· LOW STOCK' : ''}
                </strong>
              ),
            },
            {
              label: 'การเคลื่อนไหว',
              render: (r) => (
                <details>
                  <summary>ดูประวัติ</summary>
                  {r.movements.map((m) => (
                    <p key={m.id}>
                      {time(m.createdAt)} · {m.kind} · {m.quantity}
                      <small>
                        {m.reason} {m.reference}
                      </small>
                    </p>
                  ))}
                </details>
              ),
            },
          ]}
        />
        <a className="button" href={`/api/export?eventId=${eventId}&type=stock`}>
          ส่งออกสต็อก CSV
        </a>
      </section>
    </>
  );
}
export function ClosingScreen() {
  const app = useApp();
  const { eventId, revision, notify } = app;
  const data = useSummary();
  const [saved, setSaved] = useState<{
    snapshot: Record<string, unknown> | null;
    backup: { status: string } | null;
  } | null>(null);
  useEffect(() => {
    if (eventId)
      api<{ snapshot: Record<string, unknown> | null; backup: { status: string } | null }>(
        `/api/data?view=closing&eventId=${eventId}`,
      )
        .then(setSaved)
        .catch((e) => notify(e.message));
  }, [eventId, revision, notify]);
  const event = app.events.find((e) => e.id === eventId);
  if (!data) return <section className="panel">เลือกกิจกรรม</section>;
  return (
    <>
      <section className="panel">
        <h2>ตรวจสอบก่อนปิดกิจกรรม · {event?.name}</h2>
        <Badge>{event?.status ?? ''}</Badge>
        <div className="closing-metrics">
          {[
            ['ทะเบียน', data.registered],
            ['รายการขาย', data.orders],
            ['ยอดขายก่อน VOID', money(data.grossSalesSatang)],
            ['ยอดขายหลัง VOID', money(data.netSalesSatang)],
            ['ชำระยืนยัน', money(data.confirmedPaymentSatang)],
            ['บัญชียังค้าง', data.outstandingAccounts],
            ['ยอดค้าง', money(data.outstandingSatang)],
            ['ยอด VOID สินค้า', money(data.voidOrderSatang)],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <small>{label}</small>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <Badge>{data.reconciled ? 'RECONCILED' : 'RECONCILIATION ALERT'}</Badge>
        {data.outstandingSatang > 0 && (
          <p className="error">
            ยังมียอดค้าง {money(data.outstandingSatang)} ·
            การปิดจะหยุดรับรายการและการชำระในกิจกรรมนี้ ต้องยืนยันข้อยกเว้นและเหตุผลอย่างชัดเจน
          </p>
        )}
        {event?.status === 'OPEN' && (
          <Editor
            fields={[
              {
                name: 'allowOutstanding',
                label: 'อนุมัติปิดแม้มียอดค้าง',
                type: 'select',
                options: [
                  { value: 'false', label: 'ไม่อนุมัติข้อยกเว้น' },
                  { value: 'true', label: 'อนุมัติข้อยกเว้น (ผู้ดูแลสูงสุด)' },
                ],
              },
              {
                name: 'reason',
                label: 'เหตุผลปิด / ข้อยกเว้น',
                required: data.outstandingSatang > 0,
              },
            ]}
            busy={app.busy}
            label="ยืนยันปิดกิจกรรม"
            onSave={async (v) => {
              await app.op('event.close', {
                eventId,
                allowOutstanding: v.allowOutstanding === 'true',
                ...(v.reason ? { reason: v.reason } : {}),
              });
            }}
          />
        )}
        {event?.status === 'CLOSED' && (
          <Confirm
            title="จัดเก็บกิจกรรม / Archive"
            reasonRequired
            onConfirm={async (reason) => {
              await app.op('event.archive', { eventId, reason });
            }}
          />
        )}
        <p>ต้องปิดทุกกะและจัดการ QR ชำระที่ค้างยืนยันก่อน · ระบบจะขอสำรองข้อมูลหลังปิด</p>
      </section>
      {saved?.snapshot && (
        <section className="panel">
          <h2>รายงานการปิดกิจกรรมที่บันทึกแล้ว</h2>
          <p>เวลาปิด {String(saved.snapshot.closedAt)}</p>
          <p>สำรองข้อมูล: {saved.backup?.status ?? 'ไม่พบคำขอ'}</p>
          <a className="button" href={`/api/export?eventId=${eventId}&type=summary`}>
            ส่งออกสรุป CSV
          </a>
          <pre>{JSON.stringify(saved.snapshot, null, 2)}</pre>
        </section>
      )}
    </>
  );
}
