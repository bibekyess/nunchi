import type { GlossaryEntry } from '@/lib/types';

export const WHISPER_PROMPT_MAX = 200;

/**
 * Biases Whisper's spelling of names: glossary terms first, then the tail of the last
 * sentence for continuity. Kept short; long prompts make Whisper repeat itself.
 */
export function buildWhisperPrompt(
  glossary: GlossaryEntry[],
  lastSource?: string,
): string | undefined {
  const terms = [...new Set(glossary.map((g) => g.term.trim()).filter(Boolean))].join(', ');
  let prompt = terms ? `${terms}.` : '';
  if (prompt.length > WHISPER_PROMPT_MAX) {
    prompt = prompt.slice(0, WHISPER_PROMPT_MAX).replace(/,[^,]*$/, '.');
  }
  const room = WHISPER_PROMPT_MAX - prompt.length - (prompt ? 1 : 0);
  const last = lastSource?.trim();
  if (last && room > 20) {
    const tail = last.length > room ? last.slice(last.length - room) : last;
    prompt = prompt ? `${prompt} ${tail}` : tail;
  }
  return prompt || undefined;
}
