'use client';

import { Check, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

/* Shared interaction states: color/shadow/transform transitions, a press dip and disabled. */
const PRESSABLE =
  'transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-150 ease-out enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40';

/* ------------------------------------------------------------------------------------------ */
/* Buttons                                                                                    */
/* ------------------------------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------------------------------ */
/* Dialog                                                                           */
/* ------------------------------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------------------------------ */
/* Form controls                                                                              */
/* ------------------------------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------------------------------ */
/* SegmentedControl                                                                           */
/* ------------------------------------------------------------------------------------------ */

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  /** Icon only; `label` becomes the accessible name and tooltip. */
  iconOnly?: boolean;
  /** Element id and aria-controls, for tabs that own a panel. */
  id?: string;
  controls?: string;
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
    const i = options.findIndex((o) => o.value === value);
    const last = options.length - 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? i === last
          ? 0
          : i + 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? i === 0
            ? last
            : i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    if (next < 0) return;
    e.preventDefault();
    const v = options[next].value;
    onChange(v);
    buttons.current.get(v)?.focus();
  };

  const isTabs = role === 'tablist';
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
            aria-label={o.iconOnly ? o.label : undefined}
            title={o.iconOnly ? o.label : undefined}
            tabIndex={selected ? 0 : -1}
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

/* ------------------------------------------------------------------------------------------ */
/* Menu                                                                                       */
/* ------------------------------------------------------------------------------------------ */

function menuItems(list: HTMLElement | null) {
  return Array.from(
    list?.querySelectorAll<HTMLElement>(
      '[role^="menuitem"]:not([disabled]):not([aria-disabled="true"])',
    ) ?? [],
  );
}

const MenuContext = createContext<{ close: () => void } | null>(null);

export type MenuTriggerProps = {
  onClick: () => void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  active: boolean;
};

/**
 * Glass popover menu. Closes on outside pointer, Esc or Tab (focus returns to the trigger),
 * and after an item is chosen. Arrow keys, Home and End move between items.
 *
 * The trigger props fit IconButton (`active` shows the open state).
 *
 *   <Menu label="More" trigger={(p) => <IconButton label="More" variant="ghost" {...p}>…</IconButton>}>
 *     <MenuItem icon={<BookText />} onSelect={…}>Glossary</MenuItem>
 *   </Menu>
 */
export function Menu({
  trigger,
  children,
  label,
  align = 'end',
  side = 'bottom',
  className,
}: {
  trigger: (props: MenuTriggerProps) => ReactNode;
  children: ReactNode;
  /** Accessible name of the menu. */
  label?: string;
  align?: 'start' | 'end';
  side?: 'bottom' | 'top';
  className?: string;
}) {
  // Where the panel is portaled while open: the enclosing <dialog> (top layer) or <body>.
  // Portaling escapes the stacking context and backdrop root of glass ancestors.
  const [host, setHost] = useState<HTMLElement | null>(null);
  const open = host !== null;
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((refocus = false) => {
    setHost(null);
    if (refocus) root.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();
  }, []);

  // Pin the panel to the trigger. Fixed positioning is relative to the host when it is a
  // dialog (its backdrop-filter makes it the containing block).
  useLayoutEffect(() => {
    if (!host) return;
    const place = () => {
      const t = root.current?.getBoundingClientRect();
      const p = list.current;
      if (!t || !p) return;
      const h =
        host === document.body
          ? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
          : host.getBoundingClientRect();
      p.style.left = align === 'start' ? `${t.left - h.left}px` : '';
      p.style.right = align === 'end' ? `${h.right - t.right}px` : '';
      p.style.top = side === 'bottom' ? `${t.bottom - h.top + 8}px` : '';
      p.style.bottom = side === 'top' ? `${h.bottom - t.top + 8}px` : '';
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [host, align, side]);

  useEffect(() => {
    if (!open) return;
    menuItems(list.current)[0]?.focus();
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !list.current?.contains(t)) close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); // inside a <dialog>, Esc closes only the menu
      close(true);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      // The panel is portaled to the end of <body>; let Tab continue from the trigger instead.
      e.preventDefault();
      return close(true);
    }
    const all = menuItems(list.current);
    const i = all.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'ArrowDown'
        ? (i + 1) % all.length
        : e.key === 'ArrowUp'
          ? (i - 1 + all.length) % all.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? all.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    all[next]?.focus();
  };

  return (
    <MenuContext.Provider value={{ close: () => close(true) }}>
      <div ref={root} className="relative inline-flex">
        {trigger({
          onClick: () =>
            setHost((h) => (h ? null : (root.current?.closest('dialog') ?? document.body))),
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          'aria-controls': open ? menuId : undefined,
          active: open,
        })}
        {host &&
          createPortal(
            <div
              ref={list}
              id={menuId}
              role="menu"
              aria-label={label}
              onKeyDown={onKeyDown}
              className={cx(
                'glass-strong fixed z-50 min-w-52 animate-scale-in overflow-hidden rounded-2xl p-1.5 text-ink',
                side === 'bottom'
                  ? align === 'end'
                    ? 'origin-top-right'
                    : 'origin-top-left'
                  : align === 'end'
                    ? 'origin-bottom-right'
                    : 'origin-bottom-left',
                className,
              )}
            >
              {children}
            </div>,
            host,
          )}
      </div>
    </MenuContext.Provider>
  );
}

/** A menu row. Pass `checked` to make it a radio row (role="menuitemradio" with a tick). */
export function MenuItem({
  icon,
  onSelect,
  checked,
  danger,
  keepOpen,
  className,
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> & {
  icon?: ReactNode;
  onSelect?: () => void;
  checked?: boolean;
  danger?: boolean;
  /** Keep the menu open after choosing (e.g. a theme row the user may flip through). */
  keepOpen?: boolean;
}) {
  const menu = useContext(MenuContext);
  const radio = checked !== undefined;
  return (
    <button
      type="button"
      role={radio ? 'menuitemradio' : 'menuitem'}
      aria-checked={radio ? checked : undefined}
      tabIndex={-1}
      onClick={() => {
        onSelect?.();
        if (!keepOpen) menu?.close();
      }}
      className={cx(
        'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors duration-150 outline-none hover:bg-ink/[0.06] focus-visible:bg-ink/[0.06] disabled:opacity-40',
        danger ? 'text-danger-ink' : 'text-ink',
        className,
      )}
      {...rest}
    >
      {icon && (
        <span
          className={cx(
            'flex h-4 w-4 shrink-0 [&>svg]:h-4 [&>svg]:w-4',
            !danger && 'text-ink-muted',
          )}
          aria-hidden
        >
          {icon}
        </span>
      )}
      <span className="flex-1">{children}</span>
      {radio && (
        <Check
          className={cx('h-4 w-4 text-accent', !checked && 'invisible')}
          aria-hidden
          strokeWidth={2.5}
        />
      )}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="mx-2 my-1.5 h-px bg-ink/[0.07]" />;
}

/** Small uppercase heading for a group of menu rows. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-ink-muted uppercase">
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Surfaces and labels                                                                        */
/* ------------------------------------------------------------------------------------------ */

/** Solid surface for content (transcript text, lists). */
export function Card({
  padded = true,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return (
    <div
      className={cx(
        'rounded-2xl border border-line bg-surface shadow-sm',
        padded && 'p-4',
        className,
      )}
      {...rest}
    />
  );
}

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
