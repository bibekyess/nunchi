'use client';

import { Languages } from 'lucide-react';
import { MODE_PRESETS, modeId } from '@/lib/pipeline/direction';
import { useSessionStore } from '@/lib/store/session-store';

/** Translation direction as a round icon button over a native <select> (best picker on phones). */
export function LanguageMenu() {
  const mode = useSessionStore((s) => s.session?.mode);
  const setMode = useSessionStore((s) => s.setMode);
  if (!mode) return null;
  const current = MODE_PRESETS.find((p) => p.id === modeId(mode));

  return (
    <label
      className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-background active:bg-subtle"
      title={`Translate: ${current?.label}`}
    >
      <Languages className="h-5 w-5" aria-hidden />
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
    </label>
  );
}
