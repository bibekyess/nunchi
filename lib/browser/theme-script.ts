// Server-safe theme constants (no React), shared by the root layout and lib/browser/theme.ts.

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'nunchi.theme';
/** Browser chrome colors, matching --canvas in globals.css. */
export const THEME_COLORS = { light: '#f4f4f4', dark: '#16121a' } as const;

const THEMES: readonly Theme[] = ['light', 'dark'];

export function isTheme(v: unknown): v is Theme {
  return typeof v === 'string' && (THEMES as readonly string[]).includes(v);
}

/**
 * Runs inline in <head> before first paint (keep it ES5 and self-contained).
 * Sets data-theme (the saved choice, else the OS preference) and adds the one theme-color
 * meta. Next renders none, so React never hydrates (and duplicates) it. Until a theme is
 * saved, later OS light/dark switches are followed live.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var k=${JSON.stringify(THEME_STORAGE_KEY)},q=matchMedia("(prefers-color-scheme: dark)"),d=document.documentElement,m=document.createElement("meta");
m.name="theme-color";document.head.appendChild(m);
function saved(){try{var t=localStorage.getItem(k);return t==="light"||t==="dark"?t:null}catch(e){return null}}
function apply(t){d.dataset.theme=t;m.content=t==="dark"?${JSON.stringify(THEME_COLORS.dark)}:${JSON.stringify(THEME_COLORS.light)}}
apply(saved()||(q.matches?"dark":"light"));
q.addEventListener("change",function(e){if(!saved())apply(e.matches?"dark":"light")});
}catch(e){}})()`;
