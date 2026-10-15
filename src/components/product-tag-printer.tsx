'use client';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Image from 'next/image';
import { useApp, money } from './context';
import { PrintPortal } from './print-portal';
import type { ProductDto } from './types';
import './product-tags.css';

type Tag = {
  id: string;
  code: string;
  name: string;
  priceSatang: number;
  qrImage: string;
  barcodeImage: string;
  scanValue: string;
};
export function ProductTagPrinter({
  products,
  onClose,
}: {
  products: ProductDto[];
  onClose: () => void;
}) {
  const app = useApp();
  const available = products.filter((product) => product.active && product.category.active);
  const [selected, setSelected] = useState<string[]>([]);
  const [copies, setCopies] = useState(1);
  const [tags, setTags] = useState<Tag[]>([]);
  const [printing, setPrinting] = useState(false);
  const [search, setSearch] = useState('');
  const [symbol, setSymbol] = useState<'both' | 'barcode' | 'qr'>('both');
  const matching = available.filter((product) =>
    `${product.code} ${product.name}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  const lock = useRef(false);
  const sheet = useRef<HTMLDivElement>(null);
  async function prepare(print: boolean) {
    if (lock.current) return;
    lock.current = true;
    setPrinting(true);
    try {
      const result = await app.op<{ tags: Tag[] }>('product.tags', {
        productIds: selected,
        copies,
      });
      flushSync(() => setTags(result.tags));
      if (print) {
        await Promise.all(
          Array.from(sheet.current?.querySelectorAll('img') ?? []).map((image) => image.decode()),
        );
        await document.fonts.ready;
        window.print();
      }
    } catch {
      /* The app notice displays the server error. */
    } finally {
      lock.current = false;
      setPrinting(false);
    }
  }
  const disabled =
    app.busy ||
    printing ||
    selected.length === 0 ||
    selected.length > 60 ||
    selected.length * copies > 120 ||
    !Number.isInteger(copies) ||
    copies < 1 ||
    copies > 10;
  return (
    <PrintPortal>
      <div className="print-overlay product-tag-overlay" role="dialog" aria-label="พิมพ์ป้ายสินค้า">
        <div className="print-actions product-tag-controls">
          <h2>ป้ายสินค้า · ราคา + QR + Barcode</h2>
          <p>ป้าย 90 × 60 มม. บน A4 · พิมพ์ 100% · สแกนเพื่อเพิ่มสินค้า 1 ชิ้นที่ POS</p>
          <p>ราคาบนป้ายเป็นราคาปัจจุบันขณะพิมพ์ หากเปลี่ยนราคาให้พิมพ์ป้ายใหม่</p>
          <label>
            รูปแบบรหัส / Tag codes{' '}
            <select
              aria-label="Product tag codes"
              value={symbol}
              disabled={printing}
              onChange={(event) => setSymbol(event.target.value as typeof symbol)}
            >
              <option value="both">Barcode + QR</option>
              <option value="barcode">Barcode (Code 128)</option>
              <option value="qr">QR</option>
            </select>
          </label>
          <input
            aria-label="Search products to print"
            placeholder="ค้นหาชื่อหรือรหัสสินค้า / Search name or SKU"
            value={search}
            disabled={printing}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button
            aria-label="Select visible products"
            disabled={printing}
            onClick={() => {
              setSelected(matching.slice(0, 60).map((product) => product.id));
              setTags([]);
            }}
          >
            เลือกสินค้าที่แสดง (สูงสุด 60)
          </button>
          <button
            aria-label="Clear product selection"
            disabled={printing}
            onClick={() => {
              setSelected([]);
              setTags([]);
            }}
          >
            ล้างการเลือก
          </button>
          <label>
            จำนวนต่อสินค้า{' '}
            <input
              type="number"
              aria-label="Copies per product"
              min={1}
              max={10}
              value={copies}
              disabled={printing}
              onChange={(event) => {
                setCopies(Number(event.target.value));
                setTags([]);
              }}
            />
          </label>
          <div className="product-tag-selection">
            {matching.map((product) => (
              <label key={product.id}>
                <input
                  type="checkbox"
                  disabled={printing || (!selected.includes(product.id) && selected.length >= 60)}
                  checked={selected.includes(product.id)}
                  onChange={(event) => {
                    setSelected((old) =>
                      event.target.checked
                        ? [...old, product.id]
                        : old.filter((id) => id !== product.id),
                    );
                    setTags([]);
                  }}
                />{' '}
                {product.code} · {product.name} · {money(product.priceSatang)}
              </label>
            ))}
            {!matching.length && <p>ไม่พบสินค้า / No matching products</p>}
          </div>
          <p>{selected.length * copies} ป้าย · สูงสุด 120 ป้ายต่อครั้ง</p>
          <button
            aria-label="Preview product tags"
            disabled={disabled}
            onClick={() => prepare(false)}
          >
            ดูตัวอย่างป้าย
          </button>
          <button
            aria-label="Print product tags"
            className="primary"
            disabled={disabled}
            onClick={() => prepare(true)}
          >
            {printing ? 'กำลังเตรียม…' : 'พิมพ์ป้าย / บันทึก PDF'}
          </button>
          <button disabled={printing} onClick={onClose}>
            ปิด
          </button>
        </div>
        <div className="product-tag-sheet" ref={sheet}>
          {tags.map((tag, index) => (
            <article className="product-tag" key={`${tag.id}-${index}`}>
              <div className="product-tag-heading">
                <h2>{tag.name}</h2>
                <strong>{money(tag.priceSatang)}</strong>
              </div>
              <div className="product-tag-middle">
                <div>
                  <b>{tag.code}</b>
                  <p>สแกนเพื่อเลือกสินค้า</p>
                  <small>ราคา / ชิ้น</small>
                </div>
                {symbol !== 'barcode' && (
                  <Image
                    unoptimized
                    src={tag.qrImage}
                    width={384}
                    height={384}
                    alt={`QR ${tag.code}`}
                    className="product-tag-qr"
                  />
                )}
              </div>
              {symbol !== 'qr' && (
                <Image
                  unoptimized
                  src={tag.barcodeImage}
                  width={1100}
                  height={130}
                  alt={`Barcode ${tag.code}`}
                  className="product-tag-barcode"
                />
              )}
            </article>
          ))}
        </div>
      </div>
    </PrintPortal>
  );
}
