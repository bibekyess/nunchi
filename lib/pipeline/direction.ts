import { AUTO_PAIR, type Lang } from '@/lib/languages';
import type { TranslationMode } from '@/lib/types';

/** The language detected speech is assumed to be when Whisper's guess is unusable. */
export const PRIMARY_LANG: Lang = 'ko';

export interface ModePreset {
  id: string;
  group: 'auto' | 'one-way';
  mode: TranslationMode;
}

/** One-way directions offered in the language menu, in display order. */
const ONE_WAY: [Lang, Lang][] = [
  ['ko', 'en'],
  ['en', 'ko'],
  ['ne', 'en'],
  ['en', 'ne'],
];

export const MODE_PRESETS: ModePreset[] = [
  { id: 'auto', group: 'auto', mode: { source: 'auto', target: AUTO_PAIR[1] } },
  ...ONE_WAY.map(([source, target]) => ({
    id: `${source}-${target}`,
    group: 'one-way' as const,
    mode: { source, target },
  })),
];

export function modeId(mode: TranslationMode): string {
  return mode.source === 'auto' ? 'auto' : `${mode.source}-${mode.target}`;
}

/** The two languages a session's lines can be in: [spoken, translated] (auto: the auto pair). */
export function modeLangs(mode: TranslationMode): [Lang, Lang] {
  return mode.source === 'auto' ? [...AUTO_PAIR] : [mode.source, mode.target];
}

/**
 * Picks source and target for one utterance. In auto mode, speech in one language of the auto
 * pair is translated into the other (Korean ↔ English); anything else is treated as the
 * primary language, so auto mode never produces a third language.
 */
export function pickDirection(
  mode: TranslationMode,
  detected: string | undefined,
): { sourceLang: Lang; targetLang: Lang } {
  if (mode.source !== 'auto') return { sourceLang: mode.source, targetLang: mode.target };
  const sourceLang = AUTO_PAIR.find((l) => l === detected) ?? PRIMARY_LANG;
  const targetLang = AUTO_PAIR.find((l) => l !== sourceLang)!;
  return { sourceLang, targetLang };
}
