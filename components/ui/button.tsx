'use client';

import type { ButtonHTMLAttributes } from 'react';
import { cx, PRESSABLE } from './classes';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'glass' | 'accent' | 'danger';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-surface shadow-sm enabled:hover:bg-ink/88',
  secondary:
    'border border-line bg-surface text-ink shadow-sm enabled:hover:border-line-strong enabled:hover:bg-surface-2',
  ghost: 'text-ink enabled:hover:bg-ink/[0.06] enabled:active:bg-ink/[0.09]',
  glass: 'glass text-ink enabled:hover:bg-glass-strong',
  accent: 'bg-lavender text-accent-ink enabled:hover:bg-lavender-strong',
  danger: 'bg-danger text-danger-foreground shadow-sm enabled:hover:bg-danger-hover',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** sm is visually 36 px; an invisible margin keeps the 44 px touch target. */
  size?: 'sm' | 'md';
}) {
  return (
    <button
      type="button"
      className={cx(
        'relative inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap select-none',
        PRESSABLE,
        size === 'md' && 'min-h-11 px-5 text-sm',
        size === 'sm' &&
          'min-h-9 px-3.5 text-[0.8125rem] after:absolute after:inset-x-0 after:-inset-y-1',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
}

export type IconButtonVariant = 'default' | 'glass' | 'ghost';

/**
 * Round 44 px icon button. `aria-pressed` (or `active`) shows the lavender "on" state.
 */
export function IconButton({
  label,
  variant = 'default',
  size = 'md',
  active,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  variant?: IconButtonVariant;
  size?: 'md' | 'lg';
  /** Visual "on" state without aria-pressed (e.g. an open menu trigger). */
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-active={active || undefined}
      className={cx(
        'relative inline-flex shrink-0 items-center justify-center rounded-full text-ink',
        PRESSABLE,
        size === 'md' ? 'h-11 w-11' : 'h-12 w-12',
        variant === 'default' &&
          'border border-line bg-surface shadow-sm enabled:hover:border-line-strong enabled:hover:bg-surface-2',
        variant === 'glass' && 'glass enabled:hover:bg-glass-strong',
        variant === 'ghost' && 'enabled:hover:bg-ink/[0.06] enabled:active:bg-ink/[0.09]',
        'aria-pressed:border-transparent aria-pressed:bg-lavender aria-pressed:text-accent-ink',
        'data-active:border-transparent data-active:bg-lavender data-active:text-accent-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * A <label> styled like a default IconButton but pill shaped, wrapping visible content and an
 * invisible native <select> stretched over it (the best picker on phones). The ring shows
 * when the hidden select has keyboard focus.
 */
export const SELECT_PILL =
  'relative inline-flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-3.5 text-sm font-medium text-ink shadow-sm transition-[background-color,border-color] duration-150 ease-out hover:border-line-strong hover:bg-surface-2 has-[select:focus-visible]:outline-2 has-[select:focus-visible]:outline-offset-2 has-[select:focus-visible]:outline-ring [&>select]:absolute [&>select]:inset-0 [&>select]:cursor-pointer [&>select]:opacity-0';
