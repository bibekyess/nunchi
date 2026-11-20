import { describe, expect, it } from 'vitest';
import { isAutoLang, isLang, normalizeWhisperLanguage } from '@/lib/languages';

describe('normalizeWhisperLanguage', () => {
  it('maps codes and names to supported codes', () => {
    expect(normalizeWhisperLanguage('ko')).toBe('ko');
    expect(normalizeWhisperLanguage('Korean')).toBe('ko');
    expect(normalizeWhisperLanguage('english')).toBe('en');
    expect(normalizeWhisperLanguage('Nepali')).toBe('ne');
  });

  it('Nepali is supported but not part of auto mode', () => {
    expect(isLang('ne')).toBe(true);
    expect(isAutoLang('ne')).toBe(false);
    expect(isAutoLang('ko')).toBe(true);
  });

  it('passes unsupported languages through so callers can detect them', () => {
    expect(normalizeWhisperLanguage('japanese')).toBe('japanese');
    expect(isLang(normalizeWhisperLanguage('ja'))).toBe(false);
    expect(normalizeWhisperLanguage(undefined)).toBeUndefined();
  });
});
