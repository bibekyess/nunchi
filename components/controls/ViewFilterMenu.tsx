'use client';

import { ChevronDown } from 'lucide-react';
import { LANG_CODES, SUPPORTED_LANGS } from '@/lib/languages';
import type { ViewLang } from '@/lib/display/view';
import { useDisplayStore } from '@/lib/display/store';
import { LangFlag } from '../LangFlag';
import { cx, SELECT_PILL } from '../ui';

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
    <label className={cx(SELECT_PILL, 'pr-3 pl-2')}>
      <span className="flex shrink-0" aria-hidden>
        {view === 'all' ? (
          LANG_CODES.map((l, i) => (
            <LangFlag
              key={l}
              lang={l}
              className={i > 0 ? '-ml-1.5 ring-2 ring-surface' : undefined}
            />
          ))
        ) : (
          <LangFlag lang={view} />
        )}
      </span>
      <span className="sr-only">Show</span>
      <select
        value={view}
        onChange={(e) => setView(e.target.value as ViewLang)}
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
      <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
    </label>
  );
}
