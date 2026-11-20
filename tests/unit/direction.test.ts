import { describe, expect, it } from 'vitest';
import { MODE_PRESETS, modeId, modeLangs, pickDirection } from '@/lib/pipeline/direction';

const auto = MODE_PRESETS[0].mode;

describe('pickDirection', () => {
  it('auto: Korean → English, English → Korean', () => {
    expect(pickDirection(auto, 'ko')).toEqual({ sourceLang: 'ko', targetLang: 'en' });
    expect(pickDirection(auto, 'en')).toEqual({ sourceLang: 'en', targetLang: 'ko' });
  });

  it('auto: anything else is treated as Korean', () => {
    expect(pickDirection(auto, 'japanese')).toEqual({ sourceLang: 'ko', targetLang: 'en' });
    expect(pickDirection(auto, undefined)).toEqual({ sourceLang: 'ko', targetLang: 'en' });
  });

  it('auto: never picks Nepali, even when Whisper detects it', () => {
    expect(pickDirection(auto, 'ne')).toEqual({ sourceLang: 'ko', targetLang: 'en' });
  });

  it('Nepali modes translate one way', () => {
    expect(pickDirection({ source: 'ne', target: 'en' }, 'hi')).toEqual({
      sourceLang: 'ne',
      targetLang: 'en',
    });
    expect(pickDirection({ source: 'en', target: 'ne' }, 'en')).toEqual({
      sourceLang: 'en',
      targetLang: 'ne',
    });
  });

  it('fixed modes ignore detection', () => {
    expect(pickDirection({ source: 'en', target: 'ko' }, 'ko')).toEqual({
      sourceLang: 'en',
      targetLang: 'ko',
    });
  });

  it('round-trips preset ids', () => {
    for (const p of MODE_PRESETS) expect(modeId(p.mode)).toBe(p.id);
  });

  it('offers auto first, then every one-way direction', () => {
    expect(MODE_PRESETS.map((p) => p.id)).toEqual(['auto', 'ko-en', 'en-ko', 'ne-en', 'en-ne']);
    expect(MODE_PRESETS[0].group).toBe('auto');
  });
});

describe('modeLangs', () => {
  it('auto is Korean and English; one-way modes are their own pair', () => {
    expect(modeLangs(auto)).toEqual(['ko', 'en']);
    expect(modeLangs({ source: 'en', target: 'ne' })).toEqual(['en', 'ne']);
  });
});
