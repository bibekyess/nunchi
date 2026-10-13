'use client';

import { ChevronDown } from 'lucide-react';
import { LANG_CODES, SUPPORTED_LANGS } from '@/lib/languages';
import type { ViewLang } from '@/lib/display/view';
import { useDisplayStore } from '@/lib/store/display-store';
import { LangFlag } from '../LangFlag';

const OPTIONS: { id: ViewLang; label: string }[] = [
  { id: 'all', label: 'All languages' },
  ...LANG_CODES.map((l) => ({ id: l, label: SUPPORTED_LANGS[l].nativeName })),
];

/** Cuckoo's "All languages" pill: shows every line, or only the lines in one language. */
export function ViewFilterMenu() {
  const view = useDisplayStore((s) => s.view);
  const setView = useDisplayStore((s) => s.setView);
  const label = OPTIONS.find((o) => o.id === view)?.label ?? OPTIONS[0].label;

  return (
    <label className="relative inline-flex min-h-11 min-w-0 items-center gap-2 rounded-full border border-line pr-9 pl-2.5 text-sm">
      <span className="flex shrink-0" aria-hidden>
        {view === 'all' ? (
          LANG_CODES.map((l, i) => (
            <LangFlag key={l} lang={l} className={i > 0 ? '-ml-1.5' : undefined} />
          ))
        ) : (
          <LangFlag lang={view} />
        )}
      </span>
      <span className="sr-only">Show</span>
      <select
        value={view}
        onChange={(e) => setView(e.target.value as ViewLang)}
        className="absolute inset-0 cursor-pointer opacity-0"
        data-testid="view-filter"
      >
        {OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="truncate" aria-hidden>
        {label}
      </span>
      <ChevronDown
        className="pointer-events-none absolute right-3 h-4 w-4 text-muted"
        aria-hidden
      />
    </label>
  );
}
