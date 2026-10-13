'use client';

import { ChevronDown, Languages } from 'lucide-react';
import { MODE_PRESETS, modeId } from '@/lib/pipeline/direction';
import { useSessionStore } from '@/lib/store/session-store';

/** A styled native <select>: the best picker on phones. */
export function LanguageMenu() {
  const mode = useSessionStore((s) => s.session?.mode);
  const setMode = useSessionStore((s) => s.setMode);
  if (!mode) return null;

  return (
    <label className="relative inline-flex min-h-11 items-center gap-2 rounded-full border border-line pr-9 pl-4 text-sm">
      <Languages className="h-4 w-4 text-muted" aria-hidden />
      <span className="sr-only">Translation direction</span>
      <select
        value={modeId(mode)}
        onChange={(e) => {
          const preset = MODE_PRESETS.find((p) => p.id === e.target.value);
          if (preset) setMode(preset.mode);
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {MODE_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <span aria-hidden>{MODE_PRESETS.find((p) => p.id === modeId(mode))?.label}</span>
      <ChevronDown
        className="pointer-events-none absolute right-3 h-4 w-4 text-muted"
        aria-hidden
      />
    </label>
  );
}
