import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { isLang } from '@/lib/languages';
import { TEXT_SIZES, type Layout, type TextSize, type ViewLang } from '@/lib/display/view';

export interface DisplayState {
  view: ViewLang;
  textSize: TextSize;
  layout: Layout;
  setView: (view: ViewLang) => void;
  setTextSize: (size: TextSize) => void;
  setLayout: (layout: Layout) => void;
}

/** Side by side only applies with both languages shown (CSS stacks it below 768 px). */
export const selectColumns = (s: DisplayState) => s.layout === 'columns' && s.view === 'all';

type Persisted = Pick<DisplayState, 'view' | 'textSize' | 'layout'>;

export const DEFAULT_DISPLAY: Persisted = { view: 'all', textSize: 'm', layout: 'stacked' };

/** Drops anything stale or hand-edited in storage (e.g. a language that was removed). */
export function sanitizeDisplay(raw: unknown): Persisted {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    view: o.view === 'all' || isLang(o.view) ? (o.view as ViewLang) : DEFAULT_DISPLAY.view,
    textSize: TEXT_SIZES.includes(o.textSize as TextSize)
      ? (o.textSize as TextSize)
      : DEFAULT_DISPLAY.textSize,
    layout: o.layout === 'columns' || o.layout === 'stacked' ? o.layout : DEFAULT_DISPLAY.layout,
  };
}

/** Per-device reading preferences, shared by every session (and later the share viewer). */
export const useDisplayStore = create<DisplayState>()(
  persist(
    (set) => ({
      ...DEFAULT_DISPLAY,
      setView: (view) => set({ view }),
      setTextSize: (textSize) => set({ textSize }),
      setLayout: (layout) => set({ layout }),
    }),
    {
      name: 'nunchi.display',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ view, textSize, layout }) => ({ view, textSize, layout }),
      merge: (persisted, current) => ({ ...current, ...sanitizeDisplay(persisted) }),
    },
  ),
);
