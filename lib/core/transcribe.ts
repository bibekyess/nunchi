import { isLang, type Lang } from '@/lib/languages';
import type { TranscriptionResult } from '@/lib/types';
import type { SpeechModel } from './models';

/** Language assumed when auto-detect lands outside the supported set. */
export const FALLBACK_LANG = 'ko' as const;

export interface TranscribeRequest {
  language: Lang | 'auto';
  prompt?: string;
  words?: boolean;
  signal?: AbortSignal;
}

export interface TranscribeOutcome {
  result: TranscriptionResult;
  /** Duration of the first transcription call. */
  firstMs: number;
  /** Duration of the fallback call, when one ran. */
  fallbackMs?: number;
}

/**
 * Transcribes a clip. Whisper often mislabels short clips (e.g. "네.") as Japanese or
 * similar; when auto-detect lands outside the supported set, it retries once with the main
 * language.
 */
export async function transcribeWithFallback(
  speech: SpeechModel,
  audio: Float32Array,
  { language, prompt, words, signal }: TranscribeRequest,
): Promise<TranscribeOutcome> {
  const forced = language === 'auto' ? undefined : language;
  let t0 = performance.now();
  let result = await speech.transcribe(audio, { language: forced, prompt, words, signal });
  const firstMs = Math.round(performance.now() - t0);
  let fallbackMs: number | undefined;

  if (!forced && result.text !== '' && !isLang(result.language)) {
    t0 = performance.now();
    result = await speech.transcribe(audio, { language: FALLBACK_LANG, prompt, words, signal });
    fallbackMs = Math.round(performance.now() - t0);
    result.language ??= FALLBACK_LANG;
  }

  return { result, firstMs, fallbackMs };
}
