import type { Lang, Utterance } from '@/lib/types';

/** Cuckoo's "All languages" menu: show every line, or only the lines in one language. */
export type ViewLang = 'all' | Lang;
export type TextSize = 's' | 'm' | 'l';
export type Layout = 'stacked' | 'columns';

export const TEXT_SIZES: TextSize[] = ['s', 'm', 'l'];
export const TEXT_SIZE_NAMES: Record<TextSize, string> = { s: 'Small', m: 'Medium', l: 'Large' };

export function nextTextSize(size: TextSize): TextSize {
  return TEXT_SIZES[(TEXT_SIZES.indexOf(size) + 1) % TEXT_SIZES.length];
}

export interface VisibleParts {
  source: boolean;
  translation: boolean;
}

/**
 * Which lines of an utterance to show for a language filter. Filtering is by language, not by
 * role: with "English" picked, an English speaker's original and a Korean speaker's translation
 * both show, so the view reads as one English transcript. Lines whose language isn't known yet
 * (still transcribing) stay visible.
 */
export function visibleParts(
  u: Pick<Utterance, 'sourceLang' | 'targetLang'>,
  view: ViewLang,
): VisibleParts {
  if (view === 'all') return { source: true, translation: true };
  return {
    source: u.sourceLang === undefined || u.sourceLang === view,
    translation: u.targetLang === undefined || u.targetLang === view,
  };
}
