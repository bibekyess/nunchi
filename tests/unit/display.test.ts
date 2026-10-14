import { describe, expect, it } from 'vitest';
import { nextTextSize, visibleParts } from '@/lib/display/view';
import { DEFAULT_DISPLAY, sanitizeDisplay } from '@/lib/store/display-store';

describe('visibleParts', () => {
  const koSpeaker = { sourceLang: 'ko', targetLang: 'en' } as const;
  const enSpeaker = { sourceLang: 'en', targetLang: 'ko' } as const;

  it('shows both lines for All languages', () => {
    expect(visibleParts(koSpeaker, 'all')).toEqual({ source: true, translation: true });
  });

  it('filters by language, not by role', () => {
    // "English": the Korean speaker's translation and the English speaker's original.
    expect(visibleParts(koSpeaker, 'en')).toEqual({ source: false, translation: true });
    expect(visibleParts(enSpeaker, 'en')).toEqual({ source: true, translation: false });
    expect(visibleParts(koSpeaker, 'ko')).toEqual({ source: true, translation: false });
    expect(visibleParts(enSpeaker, 'ko')).toEqual({ source: false, translation: true });
  });

  it('keeps lines whose language is not known yet', () => {
    expect(visibleParts({}, 'en')).toEqual({ source: true, translation: true });
  });
});

describe('nextTextSize', () => {
  it('cycles S → M → L → S', () => {
    expect(nextTextSize('s')).toBe('m');
    expect(nextTextSize('m')).toBe('l');
    expect(nextTextSize('l')).toBe('s');
  });
});

describe('sanitizeDisplay', () => {
  it('keeps valid values', () => {
    expect(sanitizeDisplay({ view: 'ko', textSize: 'l', layout: 'columns' })).toEqual({
      view: 'ko',
      textSize: 'l',
      layout: 'columns',
    });
  });

  it('replaces stale or junk values with defaults', () => {
    expect(sanitizeDisplay({ view: 'ja', textSize: 'xl', layout: 'grid' })).toEqual(
      DEFAULT_DISPLAY,
    );
    expect(sanitizeDisplay(undefined)).toEqual(DEFAULT_DISPLAY);
  });
});
