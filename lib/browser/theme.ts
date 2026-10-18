import { useCallback, useSyncExternalStore } from 'react';
import { readString, writeString } from '@/lib/browser/storage';
import { isTheme, THEME_COLORS, THEME_STORAGE_KEY, type Theme } from '@/lib/browser/theme-script';

export type { Theme } from '@/lib/browser/theme-script';

/** The saved choice; with none yet, the OS preference. */
export function readTheme(): Theme {
  const v = readString(THEME_STORAGE_KEY);
  if (isTheme(v)) return v;
  // Nothing saved (or storage blocked): the OS preference.
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.content = THEME_COLORS[theme];
  });
}

const listeners = new Set<() => void>();

export function setTheme(theme: Theme) {
  // If storage is blocked (private mode), the choice still applies for this page.
  writeString(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
  listeners.forEach((l) => l());
}

function current(): Theme {
  const v = document.documentElement.dataset.theme;
  return isTheme(v) ? v : readTheme();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  // Another tab changed the theme.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY && e.key !== null) return;
    applyTheme(readTheme());
    cb();
  };
  window.addEventListener('storage', onStorage);
  // The theme script re-applies OS switches while nothing is saved; re-read after it.
  const os = matchMedia('(prefers-color-scheme: dark)');
  os.addEventListener('change', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
    os.removeEventListener('change', cb);
  };
}

/** The current theme ('light' during SSR) and a setter that persists it. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, current, () => 'light' as const);
  return [theme, useCallback((t: Theme) => setTheme(t), [])];
}
