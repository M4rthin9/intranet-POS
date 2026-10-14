'use client';
import { useEffect, useState } from 'react';
export function usePersistentIntent<T>(key: string) {
  const [value, setValue] = useState<T | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const stored = sessionStorage.getItem(key);
        if (stored) setValue(JSON.parse(stored) as T);
      } catch {
        /* An invalid transient draft cannot be replayed. */
      }
      setReady(true);
    });
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    try {
      if (value) sessionStorage.setItem(key, JSON.stringify(value));
      else sessionStorage.removeItem(key);
    } catch {
      /* Memory still retains the same retry key when device storage is unavailable. */
    }
  }, [key, ready, value]);
  return [value, setValue] as const;
}
