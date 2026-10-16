'use client';
import Image from 'next/image';
import { useRef, useState } from 'react';
import { Upload, ImagePlus, X } from 'lucide-react';
import { api } from './context';
import { PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_TYPES } from '@/lib/product-image-limits';
import './product-image-upload.css';

export function ProductImageUpload({
  value,
  busy,
  onChange,
  onBusyChange,
}: {
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="product-image-upload">
      <input type="hidden" name="image" value={value} />
      <div className="product-image-preview">
        {value ? (
          <Image src={value} alt="Product image preview" width={180} height={180} unoptimized />
        ) : (
          <ImagePlus size={32} />
        )}
      </div>
      <div className="product-image-controls">
        <strong>Product photo / ภาพสินค้า</strong>
        <p>JPG, PNG or WebP · up to 20 MB</p>
        <label className="product-image-file-label">
          Choose product image / เลือกไฟล์ภาพ
          <input
            ref={input}
            type="file"
            accept={PRODUCT_IMAGE_TYPES.join(',')}
            disabled={busy || uploading}
            onChange={async (event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (!file || lock.current) return;
              if (
                !PRODUCT_IMAGE_TYPES.includes(file.type) ||
                file.size > PRODUCT_IMAGE_MAX_BYTES ||
                !file.size
              ) {
                setError('Choose a JPG, PNG or WebP image up to 20 MB.');
                return;
              }
              lock.current = true;
              setUploading(true);
              onBusyChange(true);
              setError('');
              try {
                const result = await api<{ image: string }>('/api/product-images', {
                  method: 'POST',
                  headers: { 'Content-Type': file.type },
                  body: file,
                });
                onChange(result.image);
              } catch (failure) {
                setError(
                  failure instanceof Error ? failure.message : 'Image upload failed. Please retry.',
                );
              } finally {
                lock.current = false;
                setUploading(false);
                onBusyChange(false);
              }
            }}
          />
        </label>
        <div className="actions">
          <button type="button" disabled={busy || uploading} onClick={() => input.current?.click()}>
            <Upload size={16} />{' '}
            {uploading ? 'Uploading…' : value ? 'Replace photo' : 'Upload photo'}
          </button>
          {value && (
            <button
              type="button"
              disabled={busy || uploading}
              onClick={() => {
                onChange('');
                setError('');
              }}
            >
              <X size={15} /> Remove
            </button>
          )}
        </div>
        <small>Save the product to apply your photo.</small>
        {uploading && <p role="status">Uploading and preparing your photo…</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
