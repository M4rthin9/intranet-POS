'use client';
import { useEffect, useState } from 'react';
import { api, useApp, money, time } from './context';
import { Table, Editor, Badge, Confirm } from './ui';
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
            label: 'เจ้าหน้าที่',
            render: (s) => s.user.displayName,
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
        <h2>สต็อกสินค้า</h2>
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
              options: products
                .filter((p) =>
                  action === 'stock.open'
                    ? !rows.some((r) => r.product.id === p.id)
                    : rows.some((r) => r.product.id === p.id),
                )
                .map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })),
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
