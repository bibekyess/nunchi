'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconButton } from './button';
import { cx } from './classes';

/** Native <dialog>: focus trap, Esc to close and backdrop for free. Animated in globals.css. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        'ui-dialog glass-strong m-auto max-w-none overflow-visible rounded-3xl p-0 text-ink',
        size === 'sm' && 'w-[min(100vw-1.5rem,24rem)]',
        size === 'md' && 'w-[min(100vw-1.5rem,32rem)]',
        size === 'lg' && 'w-[min(100vw-1.5rem,44rem)]',
      )}
    >
      <div className="flex max-h-[85dvh] flex-col">
        <h2 id={titleId} className="py-4 pr-14 pl-6 text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <div className="flex-1 overflow-y-auto px-6 pb-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-ink/[0.06] px-6 py-4">
            {footer}
          </div>
        )}
      </div>
      {/* Last in DOM order so showModal() focuses the first field, not Close. */}
      <span className="absolute top-2 right-2">
        <IconButton label="Close" variant="ghost" onClick={onClose}>
          <X className="h-5 w-5" aria-hidden />
        </IconButton>
      </span>
    </dialog>
  );
}
