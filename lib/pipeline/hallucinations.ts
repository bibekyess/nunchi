import type { TranscriptionResult } from '@/lib/types';

/**
 * Phrases Whisper invents on silence or noise (mostly from subtitle training data).
 * Compared after normalization (lowercase, no punctuation or spaces). Extend freely.
 */
export const KNOWN_FILLERS = [
  '시청해주셔서 감사합니다',
  '시청해 주셔서 감사합니다',
  '구독과 좋아요',
  '구독과 좋아요 부탁드립니다',
  '구독 좋아요 알림설정',
  'mbc 뉴스',
  'mbc 뉴스 이덕영입니다',
  'kbs 뉴스',
  'sbs 뉴스',
  '다음 영상에서 만나요',
  '감사합니다 다음 영상에서 만나요',
  'thanks for watching',
  'thank you for watching',
  'please subscribe',
  'subtitles by the amaraorg community',
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '')
    .trim();
}

const FILLERS = new Set(KNOWN_FILLERS.map(normalize));

export interface FilterInput {
  result: TranscriptionResult;
  clipDurationMs: number;
  previousText?: string;
}

export type FilterReason = 'empty' | 'filler' | 'no-speech' | 'repeat';

/** Returns why an utterance should be dropped, or null to keep it. */
export function hallucinationReason({
  result,
  clipDurationMs,
  previousText,
}: FilterInput): FilterReason | null {
  const norm = normalize(result.text);
  if (norm === '') return 'empty';
  if (FILLERS.has(norm)) return 'filler';
  if (
    result.segments.length > 0 &&
    result.segments.every((s) => s.noSpeechProb > 0.6 && s.avgLogprob < -1.0)
  ) {
    return 'no-speech';
  }
  if (previousText !== undefined && clipDurationMs < 2000 && normalize(previousText) === norm) {
    return 'repeat';
  }
  return null;
}
