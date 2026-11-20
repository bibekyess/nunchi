/**
 * Live drafts re-transcribe the whole sentence so far, and Whisper often rewrites earlier words
 * between drafts ("I am" → "I'm", "real-" → "really", a period becomes a comma). Matching the
 * drafts letter by letter would erase and retype everything after such a change. Instead the
 * reveal works in words: words already on screen stay revealed (a correction swaps in place)
 * and only the words after them type out.
 */

interface Word {
  text: string;
  start: number;
  end: number;
  /** Lowercase, without punctuation: "Hard," and "hard." are the same word. */
  key: string;
}

function words(text: string): Word[] {
  return Array.from(text.matchAll(/\S+/gu), (m) => ({
    text: m[0],
    start: m.index,
    end: m.index + m[0].length,
    key: m[0].toLowerCase().replace(/[\p{P}\p{S}]/gu, ''),
  }));
}

/** How far a merge or split of earlier words ("I am" ↔ "I'm") can shift the word count. */
const SHIFT = 2;

/**
 * Where typing should resume in `next`, given what is on screen. Everything before the returned
 * index is shown at once; the rest types out.
 *
 * @param shown  the text currently on screen
 * @param typing true while `shown` is still being typed (its last word may be cut short)
 * @param next   the new draft
 */
export function revealFrom(shown: string, typing: boolean, next: string): number {
  if (next.startsWith(shown)) return shown.length; // the usual case: words were only added
  const old = words(shown);
  const cut = typing && !/\s$/u.test(shown) ? old.pop() : undefined;
  const fresh = words(next);
  if (old.length === 0) return resume(fresh[0], cut, 0, next.length);

  // The last whole word on screen, found in the new draft near where it was. Closest first,
  // so a repeated word ("very very") lines up with its own position.
  const last = old[old.length - 1];
  const at = old.length - 1;
  let match = -1;
  for (let d = 0; d <= SHIFT && match < 0 && last.key; d++) {
    for (const j of d === 0 ? [at] : [at - d, at + d]) {
      if (fresh[j]?.key === last.key) {
        match = j;
        break;
      }
    }
  }
  // Not found (that word itself was rewritten): keep the same number of words revealed.
  const kept = match >= 0 ? match + 1 : Math.min(old.length, fresh.length);
  if (kept >= fresh.length) return next.length; // nothing new: show the corrected draft
  return resume(fresh[kept], cut, fresh[kept - 1].end, next.length);
}

/**
 * Resume index before `word`, the first word not yet revealed: from `from` (just after the
 * previous word), or partway into `word` when it continues a word cut short on screen
 * ("wor" → "working").
 */
function resume(word: Word | undefined, cut: Word | undefined, from: number, end: number) {
  if (!word) return end;
  if (cut && word.text.toLowerCase().startsWith(cut.text.toLowerCase())) {
    return word.start + cut.text.length;
  }
  return from;
}
