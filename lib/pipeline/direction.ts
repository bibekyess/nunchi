import { isLang, LANG_CODES, type Lang } from '@/lib/languages';
import type { TranslationMode } from '@/lib/types';

/** The language detected speech is assumed to be when Whisper's guess is unusable. */
export const PRIMARY_LANG: Lang = 'ko';

export const MODE_PRESETS: { id: string; label: string; mode: TranslationMode }[] = [
  { id: 'auto', label: 'Auto (한국어 ↔ English)', mode: { source: 'auto', target: 'en' } },
  { id: 'ko-en', label: '한국어 → English', mode: { source: 'ko', target: 'en' } },
  { id: 'en-ko', label: 'English → 한국어', mode: { source: 'en', target: 'ko' } },
];

export function modeId(mode: TranslationMode): string {
  return mode.source === 'auto' ? 'auto' : `${mode.source}-${mode.target}`;
}

/**
 * Picks source and target for one utterance. In auto mode, speech in the target language is
 * translated back into the primary language (Korean ↔ English); anything unrecognized is
 * treated as the primary language.
 */
export function pickDirection(
  mode: TranslationMode,
  detected: string | undefined,
): { sourceLang: Lang; targetLang: Lang } {
  if (mode.source !== 'auto') return { sourceLang: mode.source, targetLang: mode.target };
  const sourceLang = isLang(detected) ? detected : PRIMARY_LANG;
  if (sourceLang !== mode.target) return { sourceLang, targetLang: mode.target };
  const fallback =
    sourceLang === PRIMARY_LANG ? LANG_CODES.find((l) => l !== sourceLang)! : PRIMARY_LANG;
  return { sourceLang, targetLang: fallback };
}
