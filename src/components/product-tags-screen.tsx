'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, useApp } from './context';
import type { ProductDto } from './types';
import { ProductTagPrinter } from './product-tag-printer';

export function ProductTagsScreen() {
  const { revision, notify } = useApp();
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api<ProductDto[]>('/api/data?view=products', { signal: controller.signal })
      .then((values) => {
        setProducts(values);
        setFailed(false);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setFailed(true);
          notify(error.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision, notify]);
  const available = products.filter((product) => product.active && product.category.active);
  return (
    <section className="panel">
      <h2>พิมพ์ป้ายสินค้า / Print product tags</h2>
      <p>เลือกสินค้าและจำนวนป้าย แล้วพิมพ์ Barcode, QR หรือทั้งสองแบบเพื่อแขวนกับสินค้า</p>
      <p>
        ป้ายแขวนขนาด 55 × 70 มม. แสดงชื่อ รหัส และราคาสินค้า พร้อมจุดเจาะรู 5 มม. สำหรับร้อยเชือก
        บนกระดาษ A4 ได้ 12 ป้ายต่อหน้า พิมพ์ขนาดจริง 100%
      </p>
      <div className="actions">
        <button
          className="primary"
          disabled={loading || failed || !available.length}
          onClick={() => setPrinting(true)}
        >
          เลือกสินค้าและพิมพ์ป้าย / Choose products and print
        </button>
        <Link href="/products">จัดการสินค้า / Manage products</Link>
      </div>
      <p>
        {loading
          ? 'กำลังโหลดสินค้า…'
          : failed
            ? 'โหลดสินค้าไม่สำเร็จ กรุณาเปิดเมนูนี้ใหม่เพื่อลองอีกครั้ง'
            : `สินค้าที่พร้อมพิมพ์ ${available.length} รายการ`}
      </p>
      {!loading && !failed && !available.length && <p>เพิ่มสินค้าและเปิดขายก่อนพิมพ์ป้าย</p>}
      <p>
        ที่หน้าขายสินค้า ให้เลือกช่องสแกนสินค้าแล้วสแกนป้าย เครื่องอ่านต้องส่ง Enter หลังสแกน
        แต่ละครั้งจะเพิ่มสินค้า 1 ชิ้น
      </p>
      {printing && <ProductTagPrinter products={products} onClose={() => setPrinting(false)} />}
    </section>
  );
}
