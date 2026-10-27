import { MAX_UTTERANCE_MS, type Clip } from '@/lib/audio/vad';
import { SAMPLE_RATE } from '@/lib/audio/wav';
import type { TranscriptionWord } from '@/lib/types';

// Speech detection sometimes cuts a line mid-word ("I went to hos" / "pital for checkup"), and
// Whisper then mishears both halves. When two lines look like one thought cut in two, their
// audio is transcribed again as one clip and the text is split back at the original cut.

/**
 * Longest audio gap between two clips that may still be one thought. Each clip already ends
 * with the detector's silence (redemptionMs) and the next starts with its pre-speech pad, so
 * with default settings this allows roughly a second and a half of real silence.
 */
export const REJOIN_MAX_GAP_MS = 700;

/** Silence put between the two clips when they are joined, at most. */
export const JOIN_SILENCE_MS = 150;

export interface RejoinLine {
  text: string;
  lang: string;
  clip: Clip;
}

/**
 * Audio gap between two consecutive clips. Clips never overlap, but `startedAt` is approximate,
 * so this can come out slightly negative.
 */
export function gapMs(prev: Clip, next: Clip): number {
  return next.startedAt - (prev.startedAt + prev.durationMs);
}

const SENTENCE_END = /[.?!。？！…][\p{Pe}\p{Pf}"']*$/u;

/** Whether `next` most likely continues `prev`, cut off mid-sentence. */
export function shouldRejoin(prev: RejoinLine, next: RejoinLine): boolean {
  return (
    prev.lang === next.lang &&
    prev.clip.durationMs + next.clip.durationMs <= MAX_UTTERANCE_MS &&
    gapMs(prev.clip, next.clip) <= REJOIN_MAX_GAP_MS &&
    !SENTENCE_END.test(prev.text.trim())
  );
}

export interface JoinedAudio {
  audio: Float32Array;
  /** Where the first clip ends in the joined audio, for `splitAtBoundary`. */
  boundaryMs: number;
}

const msToSamples = (ms: number) => Math.round((ms / 1000) * SAMPLE_RATE);

/** One clip of `prev` then `next`, with a short silence where they were apart. */
export function joinAudio(prev: Clip, next: Clip): JoinedAudio {
  const silence = msToSamples(Math.min(Math.max(gapMs(prev, next), 0), JOIN_SILENCE_MS));
  const audio = new Float32Array(prev.audio.length + silence + next.audio.length);
  audio.set(prev.audio);
  audio.set(next.audio, prev.audio.length + silence);
  const boundaryMs = ((prev.audio.length + silence / 2) / SAMPLE_RATE) * 1000;
  return { audio, boundaryMs };
}

/** Punctuation that closes what comes before it, so it stays with the first half. */
const CLOSING = /[\p{Pe}\p{Pf}.,!?;:。、，！？…]/u;

/**
 * Splits a joined transcript where the first clip ended, keeping Whisper's own spacing and
 * punctuation. A word belongs to the half its middle falls in. Returns null when the words
 * can't be lined up with the text (no word timings, or they differ from it).
 */
export function splitAtBoundary(
  text: string,
  words: TranscriptionWord[] | undefined,
  boundaryMs: number,
): [string, string] | null {
  if (!words?.length) return null;
  let cursor = 0;
  let cut = 0;
  for (const w of words) {
    const token = w.word.trim();
    if (!token) continue;
    const at = text.indexOf(token, cursor);
    if (at < 0) return null;
    cursor = at + token.length;
    if (((w.start + w.end) / 2) * 1000 < boundaryMs) cut = cursor;
  }
  while (cut < text.length && CLOSING.test(text[cut])) cut++;
  return [text.slice(0, cut).trim(), text.slice(cut).trim()];
}
