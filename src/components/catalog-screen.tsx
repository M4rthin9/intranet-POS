'use client';
import { useEffect, useState } from 'react';
import { api, useApp, money } from './context';
import { Editor, Table, Badge, type Field } from './ui';
import type { ProductDto, CategoryDto } from './types';
export function CatalogScreen() {
  const app = useApp();
  const { revision, notify } = app;
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [edit, setEdit] = useState<ProductDto | null>(null);
  const [categoryEdit, setCategoryEdit] = useState<CategoryDto | null>(null);
  useEffect(() => {
    Promise.all([
      api<ProductDto[]>('/api/data?view=products'),
      api<CategoryDto[]>('/api/data?view=categories'),
    ])
      .then(([p, c]) => {
        setProducts(p);
        setCategories(c);
      })
      .catch((e) => notify(e.message));
  }, [revision, notify]);
  const fields: Field[] = [
    { name: 'code', label: 'รหัสสินค้า' },
    { name: 'name', label: 'ชื่อสินค้า' },
    {
      name: 'categoryId',
      label: 'หมวดหมู่',
      type: 'select',
      options: categories.map((c) => ({ value: c.id, label: c.name })),
    },
    { name: 'priceBaht', label: 'ราคาขาย (บาท)' },
    {
      name: 'image',
      label: 'ภาพสินค้า (เส้นทางไฟล์ภายใน เช่น /products/tea.png)',
      required: false,
    },
    {
      name: 'active',
      label: 'เปิดขาย',
      type: 'select',
      options: [
        { value: 'true', label: 'เปิดขาย' },
        { value: 'false', label: 'เก็บสินค้า / Archive' },
      ],
    },
    { name: 'sortOrder', label: 'ลำดับแสดง', type: 'number', defaultValue: 0 },
    {
      name: 'trackStock',
      label: 'ควบคุมสต็อก',
      type: 'select',
      options: [
        { value: 'false', label: 'ไม่ควบคุม' },
        { value: 'true', label: 'ควบคุมสต็อก' },
      ],
    },
    { name: 'lowStockThreshold', label: 'เตือนเมื่อคงเหลือ', type: 'number', defaultValue: 5 },
  ];
  return (
    <>
      <div className="split">
        <section className="panel">
          <h2>{edit ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'}</h2>
          <Editor
            key={edit?.id ?? 'new'}
            fields={fields}
            initial={edit ? { ...edit, priceBaht: (edit.priceSatang / 100).toFixed(2) } : {}}
            busy={app.busy}
            onSave={async (v) => {
              await app.op('product.save', {
                ...v,
                image: v.image || null,
                ...(edit ? { id: edit.id } : {}),
                active: v.active === 'true',
                trackStock: v.trackStock === 'true',
              });
              setEdit(null);
            }}
          />
          {edit && <button onClick={() => setEdit(null)}>ยกเลิก</button>}
        </section>
        <section className="panel">
          <h2>หมวดหมู่สินค้า</h2>
          <Editor
            key={categoryEdit?.id ?? 'category'}
            fields={[
              { name: 'name', label: 'ชื่อหมวดหมู่' },
              { name: 'sortOrder', label: 'ลำดับแสดง', type: 'number', defaultValue: 0 },
              {
                name: 'active',
                label: 'เปิดใช้',
                type: 'select',
                options: [
                  { value: 'true', label: 'เปิดใช้' },
                  { value: 'false', label: 'เก็บหมวดหมู่' },
                ],
              },
            ]}
            initial={categoryEdit ?? {}}
            busy={app.busy}
            onSave={async (v) => {
              await app.op('category.save', {
                ...v,
                active: v.active === 'true',
                ...(categoryEdit ? { id: categoryEdit.id } : {}),
              });
              setCategoryEdit(null);
            }}
          />
          <div className="chips">
            {categories.map((c) => (
              <button key={c.id} onClick={() => setCategoryEdit(c)}>
                {c.name} {c.active ? '' : '(เก็บแล้ว)'}
              </button>
            ))}
          </div>
        </section>
      </div>
      <section className="panel">
        <Table
          rows={products}
          columns={[
            { label: 'รหัส', render: (r) => r.code },
            {
              label: 'สินค้า',
              render: (r) => (
                <>
                  {r.name}
                  <small>{r.category.name}</small>
                </>
              ),
            },
            { label: 'ราคา', render: (r) => money(r.priceSatang) },
            { label: 'สถานะ', render: (r) => <Badge>{r.active ? 'ACTIVE' : 'ARCHIVED'}</Badge> },
            { label: 'จัดการ', render: (r) => <button onClick={() => setEdit(r)}>แก้ไข</button> },
          ]}
        />
      </section>
    </>
  );
}
