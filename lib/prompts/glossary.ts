import type { GlossaryEntry } from '@/lib/types';

/** Glossary for a prompt: "term → translation" (or just the term), joined by `separator`. */
export function formatGlossary(glossary: GlossaryEntry[], separator: string): string {
  const items = glossary
    .filter((g) => g.term.trim() !== '')
    .map((g) =>
      g.translation?.trim() ? `${g.term.trim()} → ${g.translation.trim()}` : g.term.trim(),
    );
  return items.length ? items.join(separator) : '(none)';
}
