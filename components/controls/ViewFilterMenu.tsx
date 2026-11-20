'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect } from 'react';
import { AUTO_PAIR, SUPPORTED_LANGS } from '@/lib/languages';
import type { ViewLang } from '@/lib/display/view';
import { useDisplayStore } from '@/lib/display/store';
import { modeLangs } from '@/lib/pipeline/direction';
import { useSessionStore } from '@/lib/session/store';
import { LangFlag } from '../LangFlag';
import { cx, SELECT_PILL } from '../ui';

/** Cuckoo's "All languages" pill: shows every line, or only the lines in one language. */
export function ViewFilterMenu() {
  const view = useDisplayStore((s) => s.view);
  const setView = useDisplayStore((s) => s.setView);
  const mode = useSessionStore((s) => s.session?.mode);
  // Only this session's two languages: a Nepali session offers नेपाली and English.
  const langs = mode ? modeLangs(mode) : [...AUTO_PAIR];
  const options: { id: ViewLang; label: string }[] = [
    { id: 'all', label: 'All languages' },
    ...langs.map((l) => ({ id: l, label: SUPPORTED_LANGS[l].nativeName })),
  ];
  const known = options.some((o) => o.id === view);
  const label = options.find((o) => o.id === view)?.label ?? options[0].label;

  // A filter for a language this session doesn't use would hide every line: show them all.
  useEffect(() => {
    if (mode && !known) setView('all');
  }, [mode, known, setView]);

  return (
    <label className={cx(SELECT_PILL, 'pr-3 pl-2')}>
      <span className="flex shrink-0" aria-hidden>
        {view === 'all' ? (
          langs.map((l, i) => (
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
        {options.map((o) => (
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
