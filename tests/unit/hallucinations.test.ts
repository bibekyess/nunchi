import { describe, expect, it } from 'vitest';
import { parseTranscription } from '@/lib/core/openai-compatible';
import { hallucinationReason } from '@/lib/pipeline/hallucinations';
import type { TranscriptionResult } from '@/lib/types';

const result = (
  text: string,
  segments = [{ text, noSpeechProb: 0.05, avgLogprob: -0.2 }],
): TranscriptionResult => ({
  text,
  language: 'ko',
  durationMs: 1000,
  segments,
});

describe('hallucinationReason', () => {
  it('drops empty and punctuation-only text', () => {
    expect(hallucinationReason({ result: result(''), clipDurationMs: 800 })).toBe('empty');
    expect(hallucinationReason({ result: result(' ... ?! '), clipDurationMs: 800 })).toBe('empty');
  });

  it('drops known Whisper fillers regardless of punctuation and case', () => {
    expect(
      hallucinationReason({ result: result('시청해주셔서 감사합니다.'), clipDurationMs: 3000 }),
    ).toBe('filler');
    expect(
      hallucinationReason({ result: result('Thanks for watching!'), clipDurationMs: 3000 }),
    ).toBe('filler');
    expect(
      hallucinationReason({ result: result('MBC 뉴스 이덕영입니다.'), clipDurationMs: 3000 }),
    ).toBe('filler');
  });

  it('drops segments that are all likely non-speech', () => {
    const r = result('음', [{ text: '음', noSpeechProb: 0.8, avgLogprob: -1.4 }]);
    expect(hallucinationReason({ result: r, clipDurationMs: 600 })).toBe('no-speech');
    const mixed = result('음 네', [
      { text: '음', noSpeechProb: 0.8, avgLogprob: -1.4 },
      { text: '네', noSpeechProb: 0.1, avgLogprob: -0.3 },
    ]);
    expect(hallucinationReason({ result: mixed, clipDurationMs: 600 })).toBeNull();
  });

  it('drops a short exact repeat of the previous line', () => {
    expect(
      hallucinationReason({
        result: result('감사합니다.'),
        clipDurationMs: 1500,
        previousText: '감사합니다',
      }),
    ).toBe('repeat');
    expect(
      hallucinationReason({
        result: result('감사합니다.'),
        clipDurationMs: 2500,
        previousText: '감사합니다',
      }),
    ).toBeNull();
  });

  it('keeps short valid replies', () => {
    for (const text of ['네.', '아니요.', '맞아요.', 'Yes.']) {
      expect(hallucinationReason({ result: result(text), clipDurationMs: 500 })).toBeNull();
    }
  });

  describe('servers that report no confidence scores', () => {
    it('keeps speech from a plain `json` answer (text only, no segments)', () => {
      const plain = parseTranscription({ text: ' 회의를 시작하겠습니다. ' });
      expect(hallucinationReason({ result: plain, clipDurationMs: 2500 })).toBeNull();
      // The text checks still apply.
      expect(
        hallucinationReason({
          result: parseTranscription({ text: '시청해주셔서 감사합니다' }),
          clipDurationMs: 2500,
        }),
      ).toBe('filler');
    });

    it('keeps speech whose segments lack no_speech_prob and avg_logprob', () => {
      const bare = parseTranscription({ text: '네', segments: [{ text: '네' }] });
      expect(bare.segments).toEqual([{ text: '네', noSpeechProb: 0, avgLogprob: 0 }]);
      expect(hallucinationReason({ result: bare, clipDurationMs: 600 })).toBeNull();
    });
  });
});
