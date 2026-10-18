'use client';

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cx, PRESSABLE } from './classes';

export type Tone = 'neutral' | 'accent' | 'danger' | 'warn' | 'ok';

const BADGE_TONES: Record<Tone, string> = {
  neutral: 'bg-ink/[0.06] text-ink-muted',
  accent: 'bg-lavender text-accent-ink',
  danger: 'bg-danger-soft text-danger-ink',
  warn: 'bg-warn-soft text-warn-ink',
  ok: 'bg-ok-soft text-ok-ink',
};
const DOT_TONES: Record<Tone, string> = {
  neutral: 'bg-ink-faint',
  accent: 'bg-accent',
  danger: 'bg-danger',
  warn: 'bg-warn',
  ok: 'bg-ok',
};

/** Small status label, e.g. <Badge tone="danger" dot pulse>REC</Badge>. */
export function Badge({
  tone = 'neutral',
  dot,
  pulse,
  size = 'sm',
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap tabular-nums',
        size === 'sm' ? 'h-6 px-2.5 text-xs' : 'h-8 px-3 text-[0.8125rem]',
        BADGE_TONES[tone],
        className,
      )}
      {...rest}
    >
      {dot && (
        <span
          aria-hidden
          className={cx('h-1.5 w-1.5 rounded-full', DOT_TONES[tone], pulse && 'animate-pulse-dot')}
        />
      )}
      {children}
    </span>
  );
}

/** Toggleable pill (filters, quick picks). `selected` sets aria-pressed. */
export function Chip({
  selected,
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; icon?: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx(
        'inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink',
        PRESSABLE,
        'enabled:hover:border-line-strong aria-pressed:border-transparent aria-pressed:bg-lavender aria-pressed:text-accent-ink',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
