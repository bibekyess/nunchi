import { describe, expect, it } from 'vitest';
import { buildWhisperPrompt, WHISPER_PROMPT_MAX } from '@/lib/pipeline/whisper-prompt';

describe('buildWhisperPrompt', () => {
  it('returns undefined with nothing to say', () => {
    expect(buildWhisperPrompt([])).toBeUndefined();
  });

  it('lists unique glossary terms, then the last sentence', () => {
    expect(
      buildWhisperPrompt(
        [{ term: '지민' }, { term: '누리', translation: 'Nuri' }, { term: '지민' }],
        '안녕하세요.',
      ),
    ).toBe('지민, 누리. 안녕하세요.');
  });

  it('stays within the length cap, keeping the end of the last sentence', () => {
    const glossary = Array.from({ length: 60 }, (_, i) => ({ term: `term${i}` }));
    const long = buildWhisperPrompt(glossary, 'x'.repeat(500))!;
    expect(long.length).toBeLessThanOrEqual(WHISPER_PROMPT_MAX);

    const onlySentence = buildWhisperPrompt([], 'a'.repeat(150) + 'END'.repeat(40))!;
    expect(onlySentence.length).toBeLessThanOrEqual(WHISPER_PROMPT_MAX);
    expect(onlySentence.endsWith('END')).toBe(true);
  });
});
