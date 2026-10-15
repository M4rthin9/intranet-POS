'use client';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

// Print dialogs open after a client action. Keep them outside the app hidden by print CSS.
export function PrintPortal({ children }: { children: ReactNode }) {
  return typeof document === 'undefined' ? null : createPortal(children, document.body);
}
