import type { ChatMessage } from '@/lib/core/models';
import { langName, type Lang } from '@/lib/languages';
import type { GlossaryEntry } from '@/lib/types';

/** Transcripts longer than this are summarized in parts, then the parts are merged. */
export const CHUNK_CHARS = 24_000;

export interface SummaryLine {
  seq: number;
  sourceText: string;
  translation?: string;
}

export interface SummarizePromptInput {
  glossary: GlossaryEntry[];
  meetingContext?: string;
  outputLang: Lang;
}

const SECTIONS = [
  'Use markdown with these sections:',
  '## Overview (2-3 sentences)',
  '## Key points (bullets)',
  '## Decisions',
  '## Action items ("- [ ] owner: task" when an owner is stated)',
  '## Open questions',
  'Omit a section if it would be empty. Use glossary spellings for names.',
].join('\n');

function glossaryText(glossary: GlossaryEntry[]): string {
  const items = glossary
    .filter((g) => g.term.trim())
    .map((g) =>
      g.translation?.trim() ? `${g.term.trim()} → ${g.translation.trim()}` : g.term.trim(),
    );
  return items.length ? items.join(', ') : '(none)';
}

function contextLine(meetingContext?: string): string {
  return meetingContext?.trim() ? `Meeting context: ${meetingContext.trim()}\n\n` : '';
}

export function formatLine(line: SummaryLine): string {
  const source = line.sourceText.trim();
  const translation = line.translation?.trim();
  return translation ? `[${line.seq}] ${source} => ${translation}` : `[${line.seq}] ${source}`;
}

/** Splits formatted lines into chunks of at most `maxChars` (a longer single line stays whole). */
export function chunkLines(lines: string[], maxChars = CHUNK_CHARS): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const line of lines) {
    if (current.length && size + line.length + 1 > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * Summary of a transcript or of one part of it. `part` is set when the transcript was split,
 * so the model knows it is seeing an excerpt.
 */
export function buildSummarizeMessages(
  input: SummarizePromptInput,
  lines: string[],
  part?: { index: number; total: number },
): ChatMessage[] {
  const system = [
    'You summarize meeting transcripts. The transcript was produced by speech recognition and machine translation, so expect errors; do not invent facts.',
    part
      ? `This is part ${part.index + 1} of ${part.total} of one meeting. Summarize only this part; it will be merged with the others later.`
      : '',
    `Write in ${langName(input.outputLang)}. ${SECTIONS}`,
  ]
    .filter(Boolean)
    .join('\n');

  const user = `${contextLine(input.meetingContext)}Glossary: ${glossaryText(input.glossary)}\n\nTranscript (original => translation):\n${lines.join('\n')}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Merges the summaries of consecutive parts into one summary of the whole meeting. */
export function buildMergeMessages(input: SummarizePromptInput, partials: string[]): ChatMessage[] {
  const system = [
    'You combine partial summaries of one meeting, given in order, into a single summary of the whole meeting. Merge duplicates, keep every decision and action item, and do not invent facts.',
    `Write in ${langName(input.outputLang)}. ${SECTIONS}`,
  ].join('\n');

  const parts = partials.map((p, i) => `### Part ${i + 1}\n${p.trim()}`).join('\n\n');
  const user = `${contextLine(input.meetingContext)}Glossary: ${glossaryText(input.glossary)}\n\nPartial summaries:\n${parts}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
