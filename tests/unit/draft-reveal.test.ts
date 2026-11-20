import { describe, expect, it } from 'vitest';
import { revealFrom } from '@/lib/display/draft-reveal';

/** What appears at once, and what types out, for a new draft. */
function split(shown: string, next: string, typing = false) {
  const i = revealFrom(shown, typing, next);
  return { instant: next.slice(0, i), typed: next.slice(i) };
}

describe('revealFrom', () => {
  it('types only the words that were added', () => {
    expect(split('I am', 'I am working hard')).toEqual({
      instant: 'I am',
      typed: ' working hard',
    });
    expect(split('I am working hard', 'I am working hard for family.')).toEqual({
      instant: 'I am working hard',
      typed: ' for family.',
    });
  });

  it('starts from nothing on the first draft', () => {
    expect(split('', 'I am')).toEqual({ instant: '', typed: 'I am' });
  });

  it('swaps punctuation and case changes in place', () => {
    expect(split('I am working hard.', 'I am working hard every day')).toEqual({
      instant: 'I am working hard',
      typed: ' every day',
    });
    expect(split('so, um...', 'So, um, I am working')).toEqual({
      instant: 'So, um,',
      typed: ' I am working',
    });
  });

  it('does not retype the sentence when an early word is rewritten', () => {
    // "I am" → "I'm": the word count shifts, but the last shown word is found again.
    expect(split('I am working hard', "I'm working hard for family.")).toEqual({
      instant: "I'm working hard",
      typed: ' for family.',
    });
    // A word cut off mid-speech ("real-") is finished in place.
    expect(split('So, um, I am working real-', 'So, um, I am working really hard')).toEqual({
      instant: 'So, um, I am working really',
      typed: ' hard',
    });
  });

  it('continues a word that was still being typed', () => {
    expect(split('I am wor', 'I am working hard', true)).toEqual({
      instant: 'I am wor',
      typed: 'king hard',
    });
    // The half-typed word changed: retype just that word.
    expect(split('I am wor', 'I am walking home', true)).toEqual({
      instant: 'I am',
      typed: ' walking home',
    });
  });

  it('shows a shorter or equal-length rewrite at once', () => {
    expect(split('I am working hard', 'I work hard.')).toEqual({
      instant: 'I work hard.',
      typed: '',
    });
  });

  it('works for Korean and Nepali (space-separated words)', () => {
    expect(split('저는 열심히', '저는 열심히 일하고 있어요.')).toEqual({
      instant: '저는 열심히',
      typed: ' 일하고 있어요.',
    });
    expect(split('म परिवारको लागि।', 'म परिवारको लागि मेहनत गर्छु।')).toEqual({
      instant: 'म परिवारको लागि',
      typed: ' मेहनत गर्छु।',
    });
  });
});
