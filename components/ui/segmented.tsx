'use client';

import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './classes';

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  /** Icon only; `label` becomes the accessible name and tooltip. */
  iconOnly?: boolean;
  /** Element id and aria-controls, for tabs that own a panel. */
  id?: string;
  controls?: string;
  /** Shown but not selectable; `hint` says why (tooltip and accessible name). */
  disabled?: boolean;
  hint?: string;
};

/**
 * Pill switch with a sliding indicator. `role="tablist"` for views (tabs + panels),
 * `role="radiogroup"` for settings. Arrow keys, Home and End move the selection.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  role = 'radiogroup',
  label,
  variant = 'glass',
  tone = 'surface',
  size = 'md',
  stretch = false,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentOption<T>[];
  role?: 'tablist' | 'radiogroup';
  /** Accessible name of the group. */
  label: string;
  /** Track style: glass (floating chrome) or soft (inside a surface). */
  variant?: 'glass' | 'soft';
  /** Indicator style for the selected option. */
  tone?: 'surface' | 'ink' | 'accent';
  size?: 'sm' | 'md';
  /** Options share the full width equally. */
  stretch?: boolean;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const buttons = useRef(new Map<T, HTMLButtonElement>());

  // Position the indicator straight from the DOM (no state, so no extra render per change).
  useLayoutEffect(() => {
    const place = () => {
      const el = buttons.current.get(value);
      const p = pill.current;
      if (!el || !p) return;
      p.style.width = `${el.offsetWidth}px`;
      p.style.transform = `translateX(${el.offsetLeft}px)`;
      if (!p.dataset.ready) {
        p.dataset.ready = 'true';
        // Animate only later moves, not the first placement.
        requestAnimationFrame(() => {
          p.dataset.animate = 'true';
        });
      }
    };
    place();
    const ro = new ResizeObserver(place);
    if (track.current) ro.observe(track.current);
    return () => ro.disconnect();
  }, [value, options]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    const enabled = options.filter((o) => !o.disabled);
    if (enabled.length === 0) return;
    let target: SegmentOption<T> | undefined;
    if (e.key === 'Home') target = enabled[0];
    else if (e.key === 'End') target = enabled[enabled.length - 1];
    else if (step !== 0) {
      // Move to the next selectable option, wrapping around and skipping disabled ones.
      const n = options.length;
      const from = options.findIndex((o) => o.value === value);
      for (let k = 1; k <= n && !target; k++) {
        const o = options[(((from + step * k) % n) + n) % n];
        if (!o.disabled) target = o;
      }
    }
    if (!target) return;
    e.preventDefault();
    onChange(target.value);
    buttons.current.get(target.value)?.focus();
  };

  const isTabs = role === 'tablist';
  // The Tab key lands on the selected option, or the first selectable one if that is disabled.
  const tabStop =
    options.find((o) => o.value === value && !o.disabled)?.value ??
    options.find((o) => !o.disabled)?.value;
  return (
    <div
      ref={track}
      role={role}
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx(
        'relative isolate inline-flex rounded-full p-1',
        variant === 'glass' ? 'glass' : 'bg-ink/[0.05]',
        stretch && 'flex w-full',
        className,
      )}
    >
      <span
        ref={pill}
        aria-hidden
        className={cx(
          'absolute top-1 bottom-1 left-0 -z-10 rounded-full opacity-0 data-ready:opacity-100 data-animate:transition-[transform,width] data-animate:duration-300 data-animate:ease-out',
          tone === 'surface' && 'bg-surface shadow-sm dark:bg-white/12',
          tone === 'ink' && 'bg-ink shadow-sm',
          tone === 'accent' && 'bg-lavender',
        )}
      />
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              if (el) buttons.current.set(o.value, el);
              else buttons.current.delete(o.value);
            }}
            type="button"
            role={isTabs ? 'tab' : 'radio'}
            id={o.id}
            aria-controls={o.controls}
            aria-selected={isTabs ? selected : undefined}
            aria-checked={isTabs ? undefined : selected}
            aria-label={
              o.disabled && o.hint ? `${o.label} (${o.hint})` : o.iconOnly ? o.label : undefined
            }
            title={o.disabled && o.hint ? o.hint : o.iconOnly ? o.label : undefined}
            disabled={o.disabled}
            tabIndex={o.value === tabStop ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cx(
              'relative inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors duration-200 ease-out select-none',
              size === 'md' ? 'min-h-11 text-sm' : 'min-h-9 text-[0.8125rem]',
              o.iconOnly ? (size === 'md' ? 'w-11' : 'w-9') : size === 'md' ? 'px-4' : 'px-3',
              stretch && 'flex-1',
              selected
                ? tone === 'ink'
                  ? 'text-surface'
                  : tone === 'accent'
                    ? 'text-accent-ink'
                    : 'text-ink'
                : o.disabled
                  ? 'cursor-not-allowed text-ink-faint'
                  : 'text-ink-muted hover:text-ink',
            )}
          >
            {o.icon}
            {!o.iconOnly && o.label}
          </button>
        );
      })}
    </div>
  );
}
