'use client';
import { useEffect, useRef, type ReactNode } from 'react';

export function PosCheckoutDialog({
  open,
  locked,
  onClose,
  children,
}: {
  open: boolean;
  locked: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current!;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-checkout-focus]:not(:disabled)')?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="pos-checkout-dialog"
      aria-labelledby="pos-checkout-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
