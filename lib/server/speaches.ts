import 'server-only';
import type { SpeechModel } from '@/lib/core/models';
import { createOpenAICompatible } from '@/lib/core/openai-compatible';
import { getEnv } from './env';
import { NotConfiguredError, toUpstreamError } from './http';

const TRANSCRIBE_TIMEOUT_MS = 30_000;

function authHeaders(): Record<string, string> {
  const key = getEnv().SPEACHES_API_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/**
 * The Speaches server as a `SpeechModel`: the shared OpenAI-compatible client, with failures
 * turned into `UpstreamError`s whose detail is logged server-side only.
 */
export const serverSpeech: SpeechModel = {
  async transcribe(audio, opts) {
    const env = getEnv();
    if (!env.SPEACHES_BASE_URL) throw new NotConfiguredError('speaches');
    const speech = createOpenAICompatible({
      baseUrl: env.SPEACHES_BASE_URL,
      model: env.SPEACHES_MODEL,
      apiKey: env.SPEACHES_API_KEY,
      timeoutMs: TRANSCRIBE_TIMEOUT_MS,
    }).speech;
    try {
      return await speech.transcribe(audio, opts);
    } catch (err) {
      // A cancel by the client stays an AbortError; the route logs it as aborted.
      if ((err as Error)?.name === 'AbortError' || opts?.signal?.aborted) throw err;
      throw toUpstreamError(err, 'speaches');
    }
  },
};

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
