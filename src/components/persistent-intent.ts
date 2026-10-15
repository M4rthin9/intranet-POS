'use client';
import { useCallback, useEffect, useState } from 'react';
export function usePersistentIntent<T>(key: string, validate?: (value: unknown) => value is T) {
  const [value, setValue] = useState<T | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const stored = sessionStorage.getItem(key);
        if (stored) {
          const parsed: unknown = JSON.parse(stored);
          if (!validate || validate(parsed)) setValue(parsed as T);
          else sessionStorage.removeItem(key);
        }
      } catch {
        /* An invalid transient draft cannot be replayed. */
      }
      setReady(true);
    });
  }, [key, validate]);
  const persist = useCallback(
    (next: T | null) => {
      // Save before dispatching the request, rather than waiting for a React effect.
      try {
        if (next) sessionStorage.setItem(key, JSON.stringify(next));
        else sessionStorage.removeItem(key);
      } catch {
        /* Memory still retains the same retry key when device storage is unavailable. */
      }
      setValue(next);
    },
    [key],
  );
  return [value, persist, ready] as const;
}
