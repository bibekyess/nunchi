import { describe, expect, it } from 'vitest';
import type { Clip } from '@/lib/audio/vad';
import { SAMPLE_RATE } from '@/lib/audio/wav';
import {
  JOIN_SILENCE_MS,
  joinAudio,
  REJOIN_MAX_GAP_MS,
  shouldRejoin,
  splitAtBoundary,
} from '@/lib/pipeline/rejoin';

const clip = (startedAt: number, durationMs: number, fill = 1): Clip => ({
  audio: new Float32Array((SAMPLE_RATE * durationMs) / 1000).fill(fill),
  startedAt,
  durationMs,
});

const line = (text: string, c: Clip, lang = 'en') => ({ text, lang, clip: c });

describe('shouldRejoin', () => {
  const a = clip(0, 1000);
  const close = clip(1000 + REJOIN_MAX_GAP_MS, 1000);

  it('joins a line cut off mid-sentence to the one right after it', () => {
    expect(shouldRejoin(line('I went to hoss', a), line('petal for checkup.', close))).toBe(true);
  });

  it('keeps a finished sentence, a long pause and a language change apart', () => {
    const late = clip(1001 + REJOIN_MAX_GAP_MS, 1000);
    expect(shouldRejoin(line('I went.', a), line('Then home.', close))).toBe(false);
    expect(shouldRejoin(line('다녀왔어요."', a), line('네', close))).toBe(false);
    expect(shouldRejoin(line('I went to hoss', a), line('petal', late))).toBe(false);
    expect(shouldRejoin(line('I went to', a), line('병원', close, 'ko'))).toBe(false);
  });

  it('treats a Korean sentence ending as finished, even without punctuation', () => {
    for (const text of ['다녀왔습니다', '그렇죠', '할까', '좋네', '했어요']) {
      expect(shouldRejoin(line(text, a, 'ko'), line('네', close, 'ko'))).toBe(false);
    }
    expect(shouldRejoin(line('병원에 가', a, 'ko'), line('서 검사를', close, 'ko'))).toBe(true);
  });

  it('never makes a clip longer than speech detection allows', () => {
    const long = clip(0, 20_000);
    expect(shouldRejoin(line('and', long), line('then', clip(20_000, 6000)))).toBe(false);
  });
});

describe('joinAudio', () => {
  it('puts a short silence where the clips were apart', () => {
    const { audio, boundaryMs } = joinAudio(clip(0, 100, 1), clip(1000, 100, 2));
    const silence = (SAMPLE_RATE * JOIN_SILENCE_MS) / 1000;
    expect(audio.length).toBe(1600 + silence + 1600);
    expect(audio[1599]).toBe(1);
    expect(audio[1600]).toBe(0);
    expect(audio[1600 + silence]).toBe(2);
    expect(boundaryMs).toBe(100 + JOIN_SILENCE_MS / 2);
  });

  it('keeps all of both clips when the estimated gap comes out negative', () => {
    const { audio, boundaryMs } = joinAudio(clip(0, 100, 1), clip(50, 100, 2));
    expect(audio.length).toBe(1600 + 1600);
    expect(audio[1600]).toBe(2);
    expect(boundaryMs).toBe(100);
  });
});

describe('splitAtBoundary', () => {
  const words = [
    { word: ' I', start: 0, end: 0.2 },
    { word: ' went', start: 0.2, end: 0.5 },
    { word: ' to', start: 0.5, end: 0.6 },
    { word: ' hospital,', start: 0.6, end: 1.3 }, // middle at 0.95 s: before the cut
    { word: ' for', start: 1.4, end: 1.6 },
    { word: ' checkup.', start: 1.6, end: 2.1 },
  ];

  it('splits at the word whose middle crosses the cut, keeping punctuation in place', () => {
    expect(splitAtBoundary('I went to hospital, for checkup.', words, 1100)).toEqual([
      'I went to hospital,',
      'for checkup.',
    ]);
  });

  it('keeps closing punctuation the words leave out with the first half', () => {
    const bare = words.map((w) => ({ ...w, word: w.word.replace(/[,.]/, '') }));
    expect(splitAtBoundary('I went to hospital, for checkup.', bare, 1100)).toEqual([
      'I went to hospital,',
      'for checkup.',
    ]);
  });

  it('works without spaces between words', () => {
    const ja = [
      { word: '病院', start: 0, end: 0.5 },
      { word: 'に', start: 0.5, end: 0.6 },
      { word: '行った', start: 0.8, end: 1.2 },
    ];
    expect(splitAtBoundary('病院に行った。', ja, 700)).toEqual(['病院に', '行った。']);
  });

  it('gives an empty first half when everything comes after the cut', () => {
    expect(splitAtBoundary('I went to hospital, for checkup.', words, 50)).toEqual([
      '',
      'I went to hospital, for checkup.',
    ]);
  });

  it('gives up without word timings or when they differ from the text', () => {
    expect(splitAtBoundary('I went', undefined, 500)).toBeNull();
    expect(splitAtBoundary('I went', [], 500)).toBeNull();
    expect(splitAtBoundary('I walked', words.slice(0, 2), 500)).toBeNull();
  });
});
