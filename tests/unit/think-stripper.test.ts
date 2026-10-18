import { describe, expect, it } from 'vitest';
import { stripThink, ThinkStripper } from '@/lib/core/think-stripper';

function streamThrough(chunks: string[]): string {
  const s = new ThinkStripper();
  return chunks.map((c) => s.push(c)).join('') + s.flush();
}

/** Every way of cutting `text` into two chunks, plus one char at a time. */
function allSplits(text: string): string[][] {
  const splits: string[][] = [[...text]];
  for (let i = 0; i <= text.length; i++) splits.push([text.slice(0, i), text.slice(i)]);
  return splits;
}

describe('ThinkStripper', () => {
  it('passes plain text through', () => {
    expect(streamThrough(['Hello ', 'world.'])).toBe('Hello world.');
  });

  it('removes the empty think block Qwen emits with thinking disabled', () => {
    for (const chunks of allSplits('<think>\n\n</think>\n\nHello, world.')) {
      expect(streamThrough(chunks)).toBe('Hello, world.');
    }
  });

  it('removes reasoning content split across any chunk boundary', () => {
    for (const chunks of allSplits('<think>The user wants English.</think>Is it working?')) {
      expect(streamThrough(chunks)).toBe('Is it working?');
    }
  });

  it('keeps text that only looks like the start of a tag', () => {
    expect(streamThrough(['a <thi', 's is fine'])).toBe('a <this is fine');
    expect(streamThrough(['ends with <th'])).toBe('ends with <th');
  });

  it('removes a think block in the middle and keeps both sides', () => {
    expect(streamThrough(['Yes. <think>hm', 'm</think>', 'No.'])).toBe('Yes. No.');
  });

  it('drops an unterminated think block', () => {
    expect(streamThrough(['<think>never closes'])).toBe('');
  });

  it('keeps inner whitespace of the answer', () => {
    expect(streamThrough(['  Hello', '  world  '])).toBe('Hello  world  ');
  });

  it('stripThink trims the result', () => {
    expect(stripThink('<think>x</think>\n 네. \n')).toBe('네.');
  });
});
