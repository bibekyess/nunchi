import { langName, type Lang } from '@/lib/languages';
import type { GlossaryEntry, TranslationContextItem } from '@/lib/types';

export interface TranslatePromptInput {
  text: string;
  sourceLang: Lang;
  targetLang: Lang;
  context: TranslationContextItem[];
  glossary: GlossaryEntry[];
  meetingContext?: string;
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

function glossaryLines(glossary: GlossaryEntry[]): string {
  const lines = glossary
    .filter((g) => g.term.trim() !== '')
    .map((g) =>
      g.translation?.trim() ? `${g.term.trim()} → ${g.translation.trim()}` : g.term.trim(),
    );
  return lines.length ? lines.join('\n') : '(none)';
}

export function buildTranslateMessages(input: TranslatePromptInput): ChatMessage[] {
  const sourceName = langName(input.sourceLang);
  const targetName = langName(input.targetLang);

  const system = [
    input.meetingContext?.trim() ? `Meeting context: ${input.meetingContext.trim()}\n` : '',
    `You are a live interpreter at a meeting. Translate the CURRENT line from ${sourceName} to ${targetName}.`,
    '',
    'Rules:',
    '- Output only the translation of the CURRENT line. No quotes, notes, romanization, or explanations.',
    '- The line comes from speech recognition and may contain errors or be a fragment. Translate the most likely intended meaning; keep fragments as fragments.',
    '- Use the previous lines only to resolve omitted subjects, pronouns, and terms. Do not translate them again.',
    '- Korean often drops the subject; infer it from context, and use "we" or "I" naturally.',
    "- Match the speaker's register: casual stays casual, formal stays polite.",
    '- Keep numbers, product names, and code identifiers exactly as spoken.',
    '- Always use these glossary translations:',
    glossaryLines(input.glossary),
  ]
    .filter((line, i) => i !== 0 || line !== '')
    .join('\n');

  const previous = input.context.length
    ? input.context.map((c) => `- ${c.source} => ${c.translation}`).join('\n')
    : '(start of meeting)';

  const user = `Previous lines (for context only):\n${previous}\n\nCURRENT line:\n${input.text}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
