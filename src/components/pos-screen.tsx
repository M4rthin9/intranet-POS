'use client';
import { requestKey } from '../lib/client-key';
import { useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import { Search, Plus, Minus, Star, ScanLine, ShoppingCart } from 'lucide-react';
import { api, useApp, money, ApiError, time } from './context';
import { Badge, Table } from './ui';
import type { ProductDto, CategoryDto, AccountDto, OrderDto } from './types';
import { usePersistentIntent } from './persistent-intent';
type Intent = {
  key: string;
  eventId: string;
  stationId: string;
  token: string;
  expectedTotalSatang: number;
  items: { productId: string; quantity: number }[];
};
export function PosScreen() {
  const app = useApp();
  const { eventId, stationId, revision, notify } = app;
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [token, setToken] = useState('');
  const [account, setAccount] = useState<AccountDto | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [intent, setIntent] = usePersistentIntent<Intent>(
    `ccida:intent:${app.user.id}:${eventId}:${stationId}`,
  );
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    Promise.all([
      api<ProductDto[]>(`/api/data?view=products&eventId=${eventId}`),
      api<CategoryDto[]>('/api/data?view=categories'),
    ])
      .then(([p, c]) => {
        setProducts(p.filter((p) => p.active));
        setCategories(c.filter((c) => c.active));
      })
      .catch((e) => notify(e.message));
    if (eventId)
      api<OrderDto[]>(`/api/data?view=orders&eventId=${eventId}`)
        .then(setOrders)
        .catch((e) => notify(e.message));
  }, [eventId, revision, notify]);
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const stored = JSON.parse(localStorage.getItem('ccida-favorites') ?? '[]');
        if (Array.isArray(stored) && stored.every((id) => typeof id === 'string'))
          setFavorites(stored);
      } catch {
        /* Recover an invalid device preference. */
      }
    });
  }, []);
  useEffect(() => {
    if (checkout) scanRef.current?.focus();
  }, [checkout]);
  const activeCart = intent
    ? Object.fromEntries(intent.items.map((i) => [i.productId, i.quantity]))
    : cart;
  const lines = Object.entries(activeCart)
    .map(([id, quantity]) => ({ product: products.find((p) => p.id === id), quantity }))
    .filter((line): line is { product: ProductDto; quantity: number } => !!line.product);
  const total =
    intent?.expectedTotalSatang ??
    lines.reduce((a, l) => a + l.product.priceSatang * l.quantity, 0);
  function change(id: string, delta: number) {
    if (intent) return;
    setCart((old) => {
      const copy = { ...old };
      copy[id] = Math.min(99, (copy[id] ?? 0) + delta);
      if (copy[id] <= 0) delete copy[id];
      return copy;
    });
  }
  function favorite(id: string) {
    const next = favorites.includes(id) ? favorites.filter((x) => x !== id) : [...favorites, id];
    setFavorites(next);
    try {
      localStorage.setItem('ccida-favorites', JSON.stringify(next));
    } catch {
      /* Preferences stay in memory. */
    }
  }
  async function lookup() {
    try {
      setAccount(
        await app.op<AccountDto>('account.lookup', {
          eventId,
          token: intent?.token ?? token.trim(),
        }),
      );
    } catch {
      setAccount(null);
    }
  }
  async function confirm() {
    const payload = intent ?? {
      key: requestKey(),
      eventId,
      stationId,
      token: token.trim(),
      expectedTotalSatang: total,
      items: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
    };
    setIntent(payload);
    try {
      const order = await app.op<OrderDto>('order.create', payload);
      setRecent((old) =>
        [...new Set([...payload.items.map((i) => i.productId), ...old])].slice(0, 12),
      );
      setCart({});
      setIntent(null);
      setAccount(null);
      setToken('');
      setCheckout(false);
      notify(`บันทึก ${order.number} · ${money(order.totalSatang)} · รับชำระที่จุดชำระเงิน`);
    } catch (e) {
      if (e instanceof ApiError && e.status > 0 && e.status < 500) setIntent(null);
    }
  }
  const visible = products.filter(
    (p) =>
      (category === 'all' ||
        (category === 'favorites' && favorites.includes(p.id)) ||
        (category === 'recent' && recent.includes(p.id)) ||
        p.categoryId === category) &&
      `${p.name} ${p.code}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="pos-layout">
        <section className="product-area">
          <div className="search">
            <Search size={19} />
            <input
              placeholder="ค้นหาสินค้า / รหัสสินค้า"
              aria-label="ค้นหาสินค้า"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="category-tabs">
            {[
              { id: 'all', name: 'ทั้งหมด' },
              { id: 'favorites', name: '★ รายการโปรด' },
              { id: 'recent', name: 'ล่าสุด' },
              ...categories,
            ].map((c) => (
              <button
                key={c.id}
                className={category === c.id ? 'active' : ''}
                onClick={() => setCategory(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="products">
            {visible.map((p) => (
              <div key={p.id} className="product-tile">
                <button
                  className="favorite"
                  aria-label={`รายการโปรด ${p.name}`}
                  onClick={() => favorite(p.id)}
                >
                  <Star size={15} fill={favorites.includes(p.id) ? 'currentColor' : 'none'} />
                </button>
                <button
                  className="product-add"
                  disabled={!!intent || app.busy}
                  onClick={() => change(p.id, 1)}
                >
                  {p.image ? (
                    <Image unoptimized src={p.image} width={64} height={64} alt={p.name} />
                  ) : (
                    <span className="product-symbol">{p.name.slice(0, 1)}</span>
                  )}
                  <small>{p.code}</small>
                  <strong>{p.name}</strong>
                  <b>{money(p.priceSatang)}</b>
                  {p.trackStock && (
                    <small
                      className={
                        (p.inventories?.[0]?.remainingStock ?? 0) <= p.lowStockThreshold
                          ? 'low-stock'
                          : ''
                      }
                    >
                      คงเหลือ {p.inventories?.[0]?.remainingStock ?? 0}
                    </small>
                  )}
                </button>
              </div>
            ))}
          </div>
          {!visible.length && <div className="empty">ไม่พบสินค้า</div>}
        </section>
        <aside className="cart panel">
          <h2>
            <ShoppingCart size={19} /> รายการขาย <span>{lines.length}</span>
          </h2>
          <div className="cart-lines">
            {lines.map(({ product: p, quantity }) => (
              <div className="cart-line" key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  <small>{money(p.priceSatang)} / หน่วย</small>
                </div>
                <div className="qty">
                  <button disabled={!!intent} aria-label="ลดจำนวน" onClick={() => change(p.id, -1)}>
                    <Minus size={15} />
                  </button>
                  <b>{quantity}</b>
                  <button
                    disabled={!!intent}
                    aria-label="เพิ่มจำนวน"
                    onClick={() => change(p.id, 1)}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                <b>{money(p.priceSatang * quantity)}</b>
              </div>
            ))}
            {!lines.length && <div className="empty">แตะสินค้าเพื่อเพิ่มรายการ</div>}
          </div>
          <div className="cart-total">
            <span>ยอดรายการนี้</span>
            <strong>{money(total)}</strong>
          </div>
          <button
            className="primary checkout"
            disabled={!lines.length || !eventId || !stationId || app.busy}
            onClick={() => setCheckout(true)}
          >
            <ScanLine size={21} /> ตรวจสอบ QR และบันทึก
          </button>
          <small className="cart-note">จุดขายบันทึกรายการ · ไม่รับชำระเงิน</small>
        </aside>
      </div>
      {(checkout || intent) && (
        <section className="panel checkout-panel">
          <h2>สแกน QR ผู้ร่วมงาน</h2>
          <form
            className="scan-form"
            onSubmit={(e) => {
              e.preventDefault();
              lookup();
            }}
          >
            <input
              ref={scanRef}
              value={intent?.token ?? token}
              onChange={(e) => {
                setToken(e.target.value);
                setAccount(null);
              }}
              placeholder="สแกน QR ด้วยเครื่องอ่าน USB แล้วกด Enter"
              disabled={!!intent}
              aria-label="Customer QR"
              autoComplete="off"
              maxLength={100}
            />
            <button disabled={app.busy || !!intent}>ตรวจสอบ</button>
          </form>
          {account && (
            <div className="checkout-summary">
              <div>
                <h3>
                  {account.registrationNumber} · {account.customerName}
                </h3>
                <Badge>{account.status}</Badge>
                <p>
                  ยอดค้างเดิม {money(account.outstandingSatang)} · รายการนี้ {money(total)}
                </p>
                <p>
                  ยอดรวมหลังบันทึก <strong>{money(account.outstandingSatang + total)}</strong>
                </p>
              </div>
              <button
                className="primary"
                disabled={app.busy || (!intent && account.status !== 'ACTIVE')}
                onClick={confirm}
              >
                {intent ? 'ลองส่งรายการเดิมอีกครั้ง' : 'ยืนยันบันทึกรายการ'}
              </button>
            </div>
          )}
          {intent && (
            <div>
              <p className="error">
                สถานะการส่งยังไม่แน่นอน กรุณาลองส่งรายการเดิมอีกครั้งด้วยรหัสเดิม
              </p>
              {!account && (
                <button className="primary" disabled={app.busy} onClick={confirm}>
                  ลองส่งรายการเดิมอีกครั้ง
                </button>
              )}
            </div>
          )}
          {!intent && (
            <button
              onClick={() => {
                setCheckout(false);
                setAccount(null);
              }}
            >
              กลับไปแก้ไขตะกร้า
            </button>
          )}
        </section>
      )}
      <section className="panel">
        <h2>รายการขายล่าสุดของคุณ</h2>
        <Table
          rows={orders}
          columns={[
            { label: 'รายการ', render: (o) => o.number },
            {
              label: 'เวลา / จุดขาย',
              render: (o) => (
                <>
                  {time(o.createdAt)}
                  <small>{o.station.code}</small>
                </>
              ),
            },
            { label: 'ผู้ร่วมงาน', render: (o) => o.account?.registration.number },
            { label: 'ยอด', render: (o) => money(o.totalSatang) },
            { label: 'สถานะ', render: (o) => <Badge>{o.status}</Badge> },
            {
              label: 'สินค้า',
              render: (o) => (
                <details>
                  <summary>ดูรายการ</summary>
                  {o.items.map((i) => (
                    <p key={i.id}>
                      {i.productNameSnapshot} × {i.quantity} = {money(i.lineTotalSatang)}
                    </p>
                  ))}
                </details>
              ),
            },
          ]}
        />
      </section>
    </>
  );
}
