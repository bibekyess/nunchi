'use client';

import { Check } from 'lucide-react';
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
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from './classes';

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
