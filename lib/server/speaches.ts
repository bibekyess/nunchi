import 'server-only';
import type { SpeechModel } from '@/lib/core/models';
import { parseTranscription } from '@/lib/core/openai-compatible';
import type { Lang } from '@/lib/languages';
import type { TranscriptionResult } from '@/lib/types';
import { getEnv } from './env';
import { isTimeoutError, NotConfiguredError, UpstreamError } from './http';

const TRANSCRIBE_TIMEOUT_MS = 30_000;

function authHeaders(): Record<string, string> {
  const key = getEnv().SPEACHES_API_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

export interface TranscribeOptions {
  language?: Lang; // omit for auto-detect
  prompt?: string;
  signal?: AbortSignal;
}

export async function transcribe(
  audio: Blob,
  opts: TranscribeOptions = {},
): Promise<TranscriptionResult> {
  const env = getEnv();
  if (!env.SPEACHES_BASE_URL) throw new NotConfiguredError('speaches');
  const form = new FormData();
  form.append('file', audio, 'clip.wav');
  form.append('model', env.SPEACHES_MODEL);
  if (opts.language) form.append('language', opts.language);
  if (opts.prompt) form.append('prompt', opts.prompt);
  form.append('temperature', '0');
  form.append('response_format', 'verbose_json');

  const timeout = AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let res: Response;
  try {
    res = await fetch(`${env.SPEACHES_BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
      signal,
    });
  } catch (err) {
    if (timeout.aborted || isTimeoutError(err)) {
      throw new UpstreamError('speaches', 'upstream_timeout', undefined);
    }
    throw new UpstreamError('speaches', 'upstream_error', undefined, String(err));
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new UpstreamError('speaches', 'upstream_error', res.status, detail);
  }

  return parseTranscription(await res.json());
}

/** The Speaches server as a `SpeechModel`. */
export const serverSpeech: SpeechModel = { transcribe };

export async function pingSpeaches(timeoutMs = 5_000): Promise<boolean> {
  const base = getEnv().SPEACHES_BASE_URL;
  if (!base) return false;
  try {
    const res = await fetch(`${base}/models`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
