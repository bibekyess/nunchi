import { describe, expect, it } from 'vitest';
import {
  buildMergeMessages,
  buildSummarizeMessages,
  chunkLines,
  formatLine,
} from '@/lib/prompts/summarize';

const input = {
  glossary: [{ term: '지민', translation: 'Jimin' }, { term: '누리' }],
  meetingContext: 'Weekly product sync',
  outputLang: 'en' as const,
};

describe('summarize prompt', () => {
  it('formats lines with and without a translation', () => {
    expect(formatLine({ seq: 3, sourceText: ' 안녕하세요 ', translation: 'Hello ' })).toBe(
      '[3] 안녕하세요 => Hello',
    );
    expect(formatLine({ seq: 4, sourceText: 'Hi' })).toBe('[4] Hi');
  });

  it('builds the plan prompt with language, sections, glossary and context', () => {
    const [system, user] = buildSummarizeMessages(input, ['[0] 네 => Yes']);
    expect(system.role).toBe('system');
    expect(system.content).toContain('do not invent facts');
    expect(system.content).toContain('Write in English.');
    expect(system.content).toContain('## Action items');
    expect(system.content).not.toContain('part');
    expect(user.content).toContain('Meeting context: Weekly product sync');
    expect(user.content).toContain('Glossary: 지민 → Jimin, 누리');
    expect(user.content).toMatch(/Transcript \(original => translation\):\n\[0\] 네 => Yes$/);
  });

  it('writes in Korean when asked and says which part it is', () => {
    const [system] = buildSummarizeMessages({ ...input, outputLang: 'ko' }, ['x'], {
      index: 1,
      total: 3,
    });
    expect(system.content).toContain('Write in Korean.');
    expect(system.content).toContain('part 2 of 3');
  });

  it('merges partial summaries in order', () => {
    const [system, user] = buildMergeMessages({ ...input, glossary: [] }, ['A ', 'B']);
    expect(system.content).toContain('single summary of the whole meeting');
    expect(user.content).toContain('Glossary: (none)');
    expect(user.content).toContain('### Part 1\nA\n\n### Part 2\nB');
  });

  it('chunks by size without splitting lines', () => {
    const lines = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40), 'd'.repeat(200)];
    expect(chunkLines(lines, 100)).toEqual([[lines[0], lines[1]], [lines[2]], [lines[3]]]);
    expect(chunkLines(lines)).toEqual([lines]);
    expect(chunkLines([])).toEqual([]);
  });
});
