'use client';
import { requestKey } from '../lib/client-key';
import { useEffect, useState, useRef, useMemo } from 'react';
import Image from 'next/image';
import {
  Search,
  Plus,
  Minus,
  Star,
  ScanLine,
  ShoppingCart,
  X,
  Trash2,
  Clock3,
  ArrowRight,
  LoaderCircle,
  UserRound,
  CheckCircle2,
  Package,
  Printer,
} from 'lucide-react';
import { PosCheckoutDialog } from './pos-checkout-dialog';
import { OrderSlip } from './order-slip';
import './pos-screen.css';
import { api, useApp, money, isRejectedSubmission, time } from './context';
import { Badge, Table } from './ui';
import type { ProductDto, CategoryDto, AccountDto, OrderDto } from './types';
import { usePersistentIntent } from './persistent-intent';
import { isOrderIntent, type OrderIntent } from './intent-schemas';
import { scannedProduct } from '../lib/product-scan';
export function PosScreen() {
  const app = useApp();
  const { eventId, stationId, revision, notify } = app;
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [productScan, setProductScan] = useState('');
  const productScanRef = useRef<HTMLInputElement>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [token, setToken] = useState('');
  const [account, setAccount] = useState<AccountDto | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [checking, setChecking] = useState(false);
  const [intent, setIntent, intentReady] = usePersistentIntent<OrderIntent>(
    `ccida:intent:${app.user.id}:${eventId}:${stationId}`,
    isOrderIntent,
  );
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [slip, setSlip] = useState<{ orderId: string; eventId: string } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const lookupLock = useRef(false);
  const saveLock = useRef(false);
  const checkedToken = useRef('');
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api<ProductDto[]>(`/api/data?view=products&eventId=${eventId}`, {
        signal: controller.signal,
      }),
      api<CategoryDto[]>('/api/data?view=categories', { signal: controller.signal }),
    ])
      .then(([p, c]) => {
        setProducts(p.filter((p) => p.active));
        setCategories(c.filter((c) => c.active));
      })
      .catch((e) => {
        if (!controller.signal.aborted) notify(e.message);
      });
    if (eventId)
      api<OrderDto[]>(`/api/data?view=orders&eventId=${eventId}`, { signal: controller.signal })
        .then(setOrders)
        .catch((e) => {
          if (!controller.signal.aborted) notify(e.message);
        });
    return () => controller.abort();
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
    if (account?.status === 'ACTIVE' && !app.busy) confirmRef.current?.focus();
  }, [account, app.busy]);
  useEffect(() => {
    if (checkoutError && !checking && !app.busy && scanRef.current && !scanRef.current.disabled) {
      scanRef.current.focus();
      scanRef.current.select();
    }
  }, [checkoutError, checking, app.busy]);
  const productMap = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const activeCart = intent
    ? Object.fromEntries(intent.items.map((i) => [i.productId, i.quantity]))
    : cart;
  const lines = Object.entries(activeCart)
    .map(([id, quantity]) => ({ product: productMap.get(id), quantity }))
    .filter((line): line is { product: ProductDto; quantity: number } => !!line.product);
  const total =
    intent?.expectedTotalSatang ??
    lines.reduce((a, l) => a + l.product.priceSatang * l.quantity, 0);
  const quantityCount = lines.reduce((count, line) => count + line.quantity, 0);
  const eventOpen = app.events.find((event) => event.id === eventId)?.status === 'OPEN';
  function change(id: string, delta: number) {
    if (intent || app.busy) return;
    setCart((old) => {
      const copy = { ...old };
      const product = productMap.get(id);
      const available = product?.trackStock ? (product.inventories?.[0]?.remainingStock ?? 0) : 99;
      copy[id] = Math.min(99, available, (copy[id] ?? 0) + delta);
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
  function scanProduct() {
    if (!intentReady || intent || app.busy || !eventOpen) return;
    const product = scannedProduct(products, productScan);
    if (!product || !product.active || !product.category.active) {
      notify('ไม่พบสินค้า · สแกนป้ายสินค้าที่ช่องนี้ และสแกนบัตรลูกค้าที่หน้าชำระรายการ');
      productScanRef.current?.select();
      return;
    }
    const quantity = cart[product.id] ?? 0;
    if (
      quantity >= 99 ||
      (product.trackStock && quantity >= (product.inventories?.[0]?.remainingStock ?? 0))
    ) {
      notify('สินค้าหมด หรือถึงจำนวนสูงสุดแล้ว');
      productScanRef.current?.select();
      return;
    }
    change(product.id, 1);
    setProductScan('');
    notify(`เพิ่ม ${product.name} 1 ชิ้น`);
    productScanRef.current?.focus();
  }
  async function lookup() {
    const scanned = token.trim();
    if (lookupLock.current || saveLock.current || app.busy || intent || !scanned) return;
    if (account && checkedToken.current === scanned) {
      confirmRef.current?.focus();
      return;
    }
    lookupLock.current = true;
    setChecking(true);
    setCheckoutError('');
    try {
      const result = await app.op<AccountDto>('account.lookup', {
        eventId,
        token: scanned,
      });
      checkedToken.current = scanned;
      setAccount(result);
    } catch (error) {
      setAccount(null);
      setCheckoutError(
        error instanceof Error ? error.message : 'ไม่สามารถตรวจสอบ QR ได้ กรุณาลองใหม่',
      );
      notify('');
    } finally {
      lookupLock.current = false;
      setChecking(false);
    }
  }
  async function confirm() {
    if (
      saveLock.current ||
      lookupLock.current ||
      app.busy ||
      (!intent &&
        (!account || account.status !== 'ACTIVE' || checkedToken.current !== token.trim()))
    )
      return;
    saveLock.current = true;
    setCheckoutError('');
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
      checkedToken.current = '';
      setCheckout(false);
      setSlip({ orderId: order.id, eventId: payload.eventId });
      notify(`บันทึก ${order.number} · ${money(order.totalSatang)} · รับชำระที่จุดชำระเงิน`);
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ กรุณาลองรายการเดิม');
      notify('');
      if (isRejectedSubmission(e)) {
        setCart(Object.fromEntries(payload.items.map((item) => [item.productId, item.quantity])));
        setToken(payload.token);
        setAccount(null);
        setCheckout(true);
        setIntent(null);
      }
    } finally {
      saveLock.current = false;
    }
  }
  function closeCheckout() {
    if (app.busy || checking || intent) return;
    setCheckout(false);
    setAccount(null);
    setToken('');
    setCheckoutError('');
    checkedToken.current = '';
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
    <div className="pos-screen">
      <div className="pos-heading">
        <div>
          <span className="pos-eyebrow">CCIDA · POINT OF SALE</span>
          <h1>หน้าขายสินค้า / POS</h1>
        </div>
        <span className="pos-flow">
          <ShoppingCart size={16} /> เลือกสินค้า <ArrowRight size={14} /> สแกนบัตร{' '}
          <ArrowRight size={14} /> บันทึกรายการ
        </span>
      </div>
      <div className="pos-layout">
        <section className="product-area">
          <div className="pos-catalog-heading">
            <h2>เลือกสินค้า</h2>
            <span>{visible.length} รายการ</span>
          </div>
          <div className="pos-catalog-tools">
            <div className="search">
              <Search size={19} />
              <input
                placeholder="ค้นหาสินค้า / รหัสสินค้า"
                aria-label="ค้นหาสินค้า"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <form
              className="pos-product-scan"
              onSubmit={(event) => {
                event.preventDefault();
                scanProduct();
              }}
            >
              <label htmlFor="pos-product-scan">
                <ScanLine size={18} /> สแกน QR / Barcode สินค้า
              </label>
              <div>
                <input
                  id="pos-product-scan"
                  ref={productScanRef}
                  value={productScan}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="สแกนป้ายสินค้า หรือพิมพ์รหัสแล้วกด Enter"
                  disabled={!intentReady || !!intent || app.busy || !eventOpen}
                  onChange={(event) => setProductScan(event.target.value)}
                />
                <button
                  type="submit"
                  disabled={
                    !productScan.trim() || !intentReady || !!intent || app.busy || !eventOpen
                  }
                >
                  เพิ่มสินค้า
                </button>
              </div>
            </form>
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
                aria-pressed={category === c.id}
                onClick={() => setCategory(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="products">
            {visible.map((p) => (
              <div
                key={p.id}
                className={`product-tile${activeCart[p.id] ? ' is-selected' : ''}`}
                data-tone={
                  Math.max(
                    0,
                    categories.findIndex((category) => category.id === p.categoryId),
                  ) % 4
                }
              >
                {!!activeCart[p.id] && (
                  <span className="product-quantity">× {activeCart[p.id]}</span>
                )}
                <button
                  className="favorite"
                  aria-label={`รายการโปรด ${p.name}`}
                  aria-pressed={favorites.includes(p.id)}
                  onClick={() => favorite(p.id)}
                >
                  <Star size={15} fill={favorites.includes(p.id) ? 'currentColor' : 'none'} />
                </button>
                <button
                  className="product-add"
                  aria-label={`เพิ่ม ${p.name}`}
                  disabled={
                    !intentReady ||
                    !!intent ||
                    app.busy ||
                    !eventOpen ||
                    (cart[p.id] ?? 0) >= 99 ||
                    !p.category.active ||
                    (p.trackStock && (p.inventories?.[0]?.remainingStock ?? 0) <= (cart[p.id] ?? 0))
                  }
                  onClick={() => change(p.id, 1)}
                >
                  <span className="pos-product-photo">
                    <span className="product-symbol">{p.name.slice(0, 2)}</span>
                    {p.image && (
                      <Image
                        unoptimized
                        src={p.image}
                        width={320}
                        height={220}
                        alt={p.name}
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                        }}
                      />
                    )}
                  </span>
                  <small className="product-code">{p.code}</small>
                  <strong>{p.name}</strong>
                  <div className="product-price">
                    <b>{money(p.priceSatang)}</b>
                    <span aria-hidden="true">
                      <Plus size={17} />
                    </span>
                  </div>
                  {p.trackStock && (
                    <small
                      className={
                        (p.inventories?.[0]?.remainingStock ?? 0) <= p.lowStockThreshold
                          ? 'low-stock'
                          : ''
                      }
                    >
                      {(p.inventories?.[0]?.remainingStock ?? 0) > 0
                        ? `คงเหลือ ${p.inventories?.[0]?.remainingStock}`
                        : 'สินค้าหมด'}
                    </small>
                  )}
                </button>
              </div>
            ))}
          </div>
          {!visible.length && (
            <div className="empty">
              <Package size={32} />
              <strong>ไม่พบสินค้า</strong>
              <span>ลองค้นหาชื่อ รหัสสินค้า หรือเลือกหมวดหมู่อื่น</span>
            </div>
          )}
        </section>
        <aside className="cart panel">
          <div className="pos-cart-heading">
            <h2>
              <ShoppingCart size={19} /> รายการขาย <span>{quantityCount}</span>
            </h2>
            <button
              className="pos-clear-cart"
              disabled={!lines.length || !!intent || app.busy}
              onClick={() => setCart({})}
            >
              <Trash2 size={14} /> ล้าง
            </button>
          </div>
          <p className="pos-cart-subtitle">ตรวจสอบรายการก่อนสแกนบัตรผู้ร่วมงาน</p>
          <div className="cart-lines">
            {lines.map(({ product: p, quantity }) => (
              <div className="cart-line" key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  <small>{money(p.priceSatang)} / หน่วย</small>
                </div>
                <div className="qty">
                  <button
                    disabled={!!intent || app.busy}
                    aria-label="ลดจำนวน"
                    onClick={() => change(p.id, -1)}
                  >
                    <Minus size={15} />
                  </button>
                  <b>{quantity}</b>
                  <button
                    disabled={
                      !!intent ||
                      app.busy ||
                      quantity >= 99 ||
                      (p.trackStock && quantity >= (p.inventories?.[0]?.remainingStock ?? 0))
                    }
                    aria-label="เพิ่มจำนวน"
                    onClick={() => change(p.id, 1)}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                <b>{money(p.priceSatang * quantity)}</b>
                <button
                  className="pos-remove-line"
                  aria-label={`นำ ${p.name} ออกจากตะกร้า`}
                  disabled={!!intent || app.busy}
                  onClick={() => change(p.id, -quantity)}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            {!lines.length && (
              <div className="empty">
                <span className="pos-cart-empty-icon">
                  <ShoppingCart size={28} />
                </span>
                <strong>ยังไม่มีรายการขาย</strong>
                <span>แตะสินค้าทางซ้ายเพื่อเริ่มรายการ</span>
              </div>
            )}
          </div>
          <div className="pos-cart-footer">
            <div className="pos-cart-count">
              <span>{lines.length} รายการ</span>
              <span>{quantityCount} ชิ้น</span>
            </div>
            <div className="cart-total">
              <span>ยอดรายการนี้</span>
              <strong>{money(total)}</strong>
            </div>
            <button
              className="primary checkout"
              disabled={
                !intentReady ||
                !lines.length ||
                !eventId ||
                !stationId ||
                app.busy ||
                (!intent && !eventOpen)
              }
              onClick={() => {
                setCheckoutError('');
                setCheckout(true);
              }}
            >
              <ScanLine size={21} /> ตรวจสอบ QR และบันทึก
            </button>
            <small className="cart-note">จุดขายบันทึกรายการ · ไม่รับชำระเงิน</small>
          </div>
        </aside>
      </div>
      <PosCheckoutDialog
        open={checkout || !!intent}
        locked={app.busy || checking || !!intent}
        onClose={closeCheckout}
      >
        <div className="pos-modal-heading">
          <span className="pos-scan-icon">
            <ScanLine size={27} />
          </span>
          <div>
            <span className="pos-eyebrow">ยืนยันผู้ร่วมงาน</span>
            <h2 id="pos-checkout-title">สแกน QR ผู้ร่วมงาน</h2>
          </div>
          <button
            className="pos-modal-close"
            aria-label="ปิดหน้าต่างสแกน QR"
            disabled={app.busy || checking || !!intent}
            onClick={closeCheckout}
          >
            <X size={20} />
          </button>
        </div>
        <div className="pos-modal-body">
          <div className="pos-modal-sale">
            <span>
              {quantityCount} ชิ้น · {lines.length} รายการ
            </span>
            <strong>{money(total)}</strong>
          </div>
          <p className="pos-scan-hint">สแกนบัตรด้วยเครื่องอ่าน แล้วกด Enter เพื่อตรวจสอบ</p>
          <form
            className="scan-form"
            onSubmit={(e) => {
              e.preventDefault();
              lookup();
            }}
          >
            <input
              ref={scanRef}
              data-checkout-focus
              value={intent?.token ?? token}
              onChange={(e) => {
                setToken(e.target.value);
                setAccount(null);
                setCheckoutError('');
                checkedToken.current = '';
              }}
              placeholder="สแกน QR ด้วยเครื่องอ่าน USB แล้วกด Enter"
              disabled={!!intent || checking || app.busy}
              aria-label="Customer QR"
              autoComplete="off"
              maxLength={100}
            />
            <button disabled={app.busy || checking || !!intent || !token.trim()}>
              {checking ? (
                <LoaderCircle size={18} className="pos-spinner" aria-label="กำลังตรวจสอบ" />
              ) : (
                <ScanLine size={18} />
              )}
              <span>{checking ? 'กำลังตรวจสอบ' : 'ตรวจสอบ'}</span>
            </button>
          </form>
          {checkoutError && (
            <div className="pos-checkout-error" role="alert">
              {checkoutError}
            </div>
          )}
          {account && (
            <div className="checkout-summary">
              <div>
                <div className="pos-customer-heading">
                  <span>
                    <UserRound size={22} />
                  </span>
                  <div>
                    <small>{account.registrationNumber}</small>
                    <h3>{account.customerName}</h3>
                    <Badge>{account.isVip ? 'VIP' : 'Normal'}</Badge>
                  </div>
                  <Badge>{account.status}</Badge>
                </div>
                <div className="pos-customer-totals">
                  <p>
                    <span>ยอดค้างเดิม</span>
                    <b>{money(account.outstandingSatang)}</b>
                  </p>
                  <p>
                    <span>รายการนี้</span>
                    <b>{money(total)}</b>
                  </p>
                  <p className="pos-combined-total">
                    <span>ยอดรวมหลังบันทึก</span>
                    <strong>{money(account.outstandingSatang + total)}</strong>
                  </p>
                </div>
                {account.status !== 'ACTIVE' && !intent && (
                  <p className="error">
                    บัญชีนี้ไม่สามารถเพิ่มรายการซื้อได้ กรุณาติดต่อจุดลงทะเบียน
                  </p>
                )}
              </div>
              <button
                ref={confirmRef}
                className="primary"
                disabled={app.busy || (!intent && account.status !== 'ACTIVE')}
                onClick={confirm}
              >
                {app.busy ? (
                  <LoaderCircle size={18} className="pos-spinner" />
                ) : (
                  <CheckCircle2 size={18} />
                )}
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
                <button
                  data-checkout-focus
                  className="primary pos-retry"
                  disabled={app.busy}
                  onClick={confirm}
                >
                  ลองส่งรายการเดิมอีกครั้ง
                </button>
              )}
            </div>
          )}
          {!intent && (
            <button
              className="pos-back-to-cart"
              disabled={app.busy || checking}
              onClick={closeCheckout}
            >
              กลับไปแก้ไขตะกร้า
            </button>
          )}
          <small className="pos-modal-note">
            บันทึกการซื้อเท่านั้น · ผู้ร่วมงานชำระเงินที่จุดชำระเงิน
          </small>
        </div>
      </PosCheckoutDialog>
      <details className="pos-history">
        <summary>
          <Clock3 size={17} />
          <strong>รายการขายล่าสุดของคุณ</strong>
          <span>{orders.length} รายการ</span>
        </summary>
        <Table
          rows={orders}
          columns={[
            { label: 'รายการ', render: (o) => o.number },
            {
              label: 'เวลา / จุดขาย',
              render: (o) => <>{time(o.createdAt)}</>,
            },
            { label: 'ผู้ร่วมงาน', render: (o) => o.account?.registration.number },
            { label: 'ยอด', render: (o) => money(o.totalSatang) },
            { label: 'สถานะ', render: (o) => <Badge>{o.status}</Badge> },
            {
              label: 'ใบรายการซื้อ',
              render: (o) => (
                <button
                  disabled={app.busy || !['RECORDED', 'PAID'].includes(o.status)}
                  onClick={() => setSlip({ orderId: o.id, eventId })}
                >
                  <Printer size={16} /> พิมพ์ใบรายการซื้อ
                </button>
              ),
            },
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
      </details>
      {slip && (
        <OrderSlip
          key={slip.orderId}
          orderId={slip.orderId}
          eventId={slip.eventId}
          onClose={() => setSlip(null)}
        />
      )}
    </div>
  );
}
