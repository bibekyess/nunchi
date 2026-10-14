import { describe, expect, it } from 'vitest';
import { MODE_PRESETS, modeId, pickDirection } from '@/lib/pipeline/direction';

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

  it('fixed modes ignore detection', () => {
    expect(pickDirection({ source: 'en', target: 'ko' }, 'ko')).toEqual({
      sourceLang: 'en',
      targetLang: 'ko',
    });
  });

  it('round-trips preset ids', () => {
    for (const p of MODE_PRESETS) expect(modeId(p.mode)).toBe(p.id);
  });
});
