'use client';

import { ArrowLeftRight, ArrowRight, ChevronDown } from 'lucide-react';
import { SUPPORTED_LANGS } from '@/lib/languages';
import { MODE_PRESETS, modeId, modeLangs, type ModePreset } from '@/lib/pipeline/direction';
import { useSessionStore } from '@/lib/session/store';
import type { TranslationMode } from '@/lib/types';
import { LangFlag } from '../LangFlag';
import { cx, Menu, MenuItem, MenuLabel, MenuSeparator, SELECT_PILL } from '../ui';

/** "한국어 → English" (or ⇄ for auto), in each language's own name. */
function directionText(mode: TranslationMode): string {
  const [from, to] = modeLangs(mode);
  const arrow = mode.source === 'auto' ? '⇄' : '→';
  return `${SUPPORTED_LANGS[from].nativeName} ${arrow} ${SUPPORTED_LANGS[to].nativeName}`;
}

/** The same direction in English, as a quiet second line ("Nepali to English"). */
function directionHint(mode: TranslationMode): string {
  if (mode.source === 'auto') return 'Detects who is speaking';
  return `${SUPPORTED_LANGS[mode.source].name} to ${SUPPORTED_LANGS[mode.target].name}`;
}

/** Two overlapping flags, like the ones on the trigger. */
function FlagPair({ mode, className }: { mode: TranslationMode; className?: string }) {
  const [from, to] = modeLangs(mode);
  return (
    <span className={cx('flex shrink-0', className)} aria-hidden>
      <LangFlag lang={from} />
      <LangFlag lang={to} className="-ml-1.5 ring-2 ring-surface" />
    </span>
  );
}

function PresetRow({ preset, current }: { preset: ModePreset; current: string }) {
  const setMode = useSessionStore((s) => s.setMode);
  return (
    <MenuItem checked={preset.id === current} onSelect={() => setMode(preset.mode)}>
      <span className="flex items-center gap-3 py-1.5">
        <FlagPair mode={preset.mode} />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="font-medium">{directionText(preset.mode)}</span>
          <span className="text-xs text-ink-muted">{directionHint(preset.mode)}</span>
        </span>
      </span>
    </MenuItem>
  );
}

/**
 * Translation direction: a "KO → EN" pill (⇄ in auto mode) opening a menu with auto detect on
 * top and every one-way direction below. New directions come from MODE_PRESETS.
 */
export function LanguageMenu() {
  const mode = useSessionStore((s) => s.session?.mode);
  if (!mode) return null;
  const current = modeId(mode);
  const [from, to] = modeLangs(mode);
  const Arrow = mode.source === 'auto' ? ArrowLeftRight : ArrowRight;
  const auto = MODE_PRESETS.filter((p) => p.group === 'auto');
  const oneWay = MODE_PRESETS.filter((p) => p.group === 'one-way');

  return (
    <Menu
      label="Translation direction"
      className="w-72 max-w-[calc(100vw-2rem)]"
      trigger={({ active, ...p }) => (
        <button
          type="button"
          {...p}
          title={`Translate: ${directionText(mode)}`}
          aria-label={`Translation direction: ${directionText(mode)}`}
          data-testid="language-menu"
          className={cx(
            SELECT_PILL,
            'shrink-0 pr-2.5 pl-3.5 sm:pl-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            active && 'border-line-strong bg-surface-2',
          )}
        >
          {/* Phones: codes only, to keep the toolbar on one row. */}
          <FlagPair mode={mode} className="hidden sm:flex" />
          <span className="flex items-center gap-1.5 tracking-wide uppercase" aria-hidden>
            {from}
            <Arrow className="h-3.5 w-3.5 text-ink-muted" strokeWidth={2.25} />
            {to}
          </span>
          <ChevronDown
            className={cx(
              'h-4 w-4 text-ink-muted transition-transform duration-150',
              active && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      )}
    >
      <MenuLabel>Auto detect</MenuLabel>
      {auto.map((p) => (
        <PresetRow key={p.id} preset={p} current={current} />
      ))}
      <MenuSeparator />
      <MenuLabel>One way</MenuLabel>
      {oneWay.map((p) => (
        <PresetRow key={p.id} preset={p} current={current} />
      ))}
    </Menu>
  );
}
