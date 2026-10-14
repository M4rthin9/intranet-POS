'use client';
import { useEffect } from 'react';
export function Pwa() {
  useEffect(() => {
    if ('serviceWorker' in navigator && window.isSecureContext)
      navigator.serviceWorker
        .register('/sw.js')
        .catch(() =>
          console.warn('PWA registration unavailable. Browser operation remains available.'),
        );
  }, []);
  return null;
}
