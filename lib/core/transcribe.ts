import { samplesToMs } from '@/lib/audio/wav';
import { isLang, type Lang } from '@/lib/languages';
import type { TranscriptionResult } from '@/lib/types';
import type { SpeechModel } from './models';

/** Language assumed when auto-detect lands outside the supported set. */
export const FALLBACK_LANG = 'ko' as const;

/** Below this, Whisper's language guess is unreliable ("네." heard as English). */
export const SHORT_CLIP_MS = 2500;

export interface TranscribeRequest {
  language: Lang | 'auto';
  prompt?: string;
  words?: boolean;
  /** The previous line's language; after Korean, a short clip heard as English is checked. */
  hint?: Lang;
  signal?: AbortSignal;
}

/**
 * Why a second call ran: an unsupported language (always replaced), or a short clip heard as
 * another language after a Korean line (hint-used / hint-kept: which answer scored higher).
 */
export type FallbackKind = 'unsupported' | 'hint-used' | 'hint-kept';

export interface TranscribeOutcome {
  result: TranscriptionResult;
  /** Duration of the first transcription call. */
  firstMs: number;
  /** Duration of the fallback call, when one ran. */
  fallbackMs?: number;
  fallback?: FallbackKind;
}

/** Whisper's mean log-probability over segments; undefined when the server gives none. */
function confidence(result: TranscriptionResult): number | undefined {
  const { segments } = result;
  if (!segments.length) return undefined;
  return segments.reduce((sum, s) => sum + s.avgLogprob, 0) / segments.length;
}

/**
 * Transcribes a clip. Whisper often mislabels short clips (e.g. "네.") as Japanese or English.
 * An unsupported guess is retried in Korean. A short clip heard as another language right after
 * a Korean line is retried in Korean too, and the more confident answer is kept.
 */
export async function transcribeWithFallback(
  speech: SpeechModel,
  audio: Float32Array,
  { language, prompt, words, hint, signal }: TranscribeRequest,
): Promise<TranscribeOutcome> {
  const forced = language === 'auto' ? undefined : language;
  let t0 = performance.now();
  const result = await speech.transcribe(audio, { language: forced, prompt, words, signal });
  const firstMs = Math.round(performance.now() - t0);
  if (forced || result.text === '') return { result, firstMs };

  const unsupported = !isLang(result.language);
  // Only the failure seen in practice (Korean heard as English): checking every disagreement
  // would also turn a correct "네." after an English line into "Yes.".
  const doubted =
    hint === FALLBACK_LANG &&
    result.language !== hint &&
    samplesToMs(audio.length) < SHORT_CLIP_MS &&
    confidence(result) !== undefined;
  if (!unsupported && !doubted) return { result, firstMs };

  t0 = performance.now();
  const retried = await speech.transcribe(audio, {
    language: FALLBACK_LANG,
    prompt,
    words,
    signal,
  });
  const fallbackMs = Math.round(performance.now() - t0);
  retried.language ??= FALLBACK_LANG;
  if (unsupported) return { result: retried, firstMs, fallbackMs, fallback: 'unsupported' };

  // Strictly better: servers that omit scores report 0 for both, and then the first guess stays.
  const better = (confidence(retried) ?? -Infinity) > confidence(result)!;
  return better
    ? { result: retried, firstMs, fallbackMs, fallback: 'hint-used' }
    : { result, firstMs, fallbackMs, fallback: 'hint-kept' };
}
