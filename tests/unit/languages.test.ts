import { describe, expect, it } from 'vitest';
import { isLang, normalizeWhisperLanguage } from '@/lib/languages';

describe('normalizeWhisperLanguage', () => {
  it('maps codes and names to supported codes', () => {
    expect(normalizeWhisperLanguage('ko')).toBe('ko');
    expect(normalizeWhisperLanguage('Korean')).toBe('ko');
    expect(normalizeWhisperLanguage('english')).toBe('en');
  });

  it('passes unsupported languages through so callers can detect them', () => {
    expect(normalizeWhisperLanguage('japanese')).toBe('japanese');
    expect(isLang(normalizeWhisperLanguage('ja'))).toBe(false);
    expect(normalizeWhisperLanguage(undefined)).toBeUndefined();
  });
});
