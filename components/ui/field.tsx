'use client';

import {
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react';
import { cx } from './classes';

const FIELD =
  'w-full rounded-xl border border-line bg-surface text-base text-ink shadow-sm transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-ink-faint enabled:hover:border-line-strong focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none disabled:opacity-50 aria-invalid:border-danger aria-invalid:focus:ring-danger/20';

/** Text input; 16 px text so iOS doesn't zoom on focus. */
export function Input({
  className,
  ref,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cx(FIELD, 'min-h-11 px-3.5', className)} {...rest} />;
}

export function Textarea({
  className,
  ref,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      ref={ref}
      className={cx(FIELD, 'min-h-24 resize-y px-3.5 py-2.5 leading-relaxed', className)}
      {...rest}
    />
  );
}

/** Accessible on/off switch. Pass `label` (clickable) or an `aria-label`. */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
  className,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
}) {
  const autoId = useId();
  const switchId = id ?? autoId;
  const descId = `${switchId}-desc`;
  const control = (
    <button
      type="button"
      role="switch"
      id={switchId}
      aria-checked={checked}
      aria-describedby={description ? descId : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full bg-line-strong p-0.5 transition-colors duration-200 ease-out after:absolute after:-inset-2 aria-checked:bg-accent disabled:cursor-not-allowed disabled:opacity-40',
        !label && className,
      )}
      {...rest}
    >
      <span
        aria-hidden
        className={cx(
          'h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out',
          checked && 'translate-x-5',
        )}
      />
    </button>
  );
  if (!label) return control;
  return (
    <div className={cx('flex min-h-11 items-center justify-between gap-4', className)}>
      <div className="min-w-0">
        <label htmlFor={switchId} className="block cursor-pointer text-sm font-medium">
          {label}
        </label>
        {description && (
          <p id={descId} className="text-sm text-ink-muted">
            {description}
          </p>
        )}
      </div>
      {control}
    </div>
  );
}
