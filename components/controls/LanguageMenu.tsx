'use client';

import { ArrowLeftRight, ArrowRight } from 'lucide-react';
import { MODE_PRESETS, modeId, PRIMARY_LANG } from '@/lib/pipeline/direction';
import { useSessionStore } from '@/lib/session/store';
import { cx, SELECT_PILL } from '../ui';

/**
 * Translation direction as a "KO → EN" pill (⇄ in auto mode) over a native <select>
 * (best picker on phones).
 */
export function LanguageMenu() {
  const mode = useSessionStore((s) => s.session?.mode);
  const setMode = useSessionStore((s) => s.setMode);
  if (!mode) return null;
  const current = MODE_PRESETS.find((p) => p.id === modeId(mode));
  const auto = mode.source === 'auto';
  const from = auto ? PRIMARY_LANG : mode.source;
  const Arrow = auto ? ArrowLeftRight : ArrowRight;

  return (
    <label className={cx(SELECT_PILL, 'shrink-0')} title={`Translate: ${current?.label}`}>
      <span className="flex items-center gap-1.5 tracking-wide uppercase" aria-hidden>
        {from}
        <Arrow className="h-3.5 w-3.5 text-ink-muted" strokeWidth={2.25} />
        {mode.target}
      </span>
      <span className="sr-only">Translation direction</span>
      <select
        value={modeId(mode)}
        onChange={(e) => {
          const preset = MODE_PRESETS.find((p) => p.id === e.target.value);
          if (preset) setMode(preset.mode);
        }}
      >
        {MODE_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}
