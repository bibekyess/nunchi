import 'server-only';
import OpenAI from 'openai';
import { getEnv } from './env';

let client: OpenAI | undefined;

/** OpenAI-compatible client for the self-hosted vLLM Qwen server. */
export function getLlm(): OpenAI {
  if (client) return client;
  const env = getEnv();
  client = new OpenAI({
    baseURL: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
    defaultHeaders:
      env.LLM_HEADER_NAME && env.LLM_HEADER_VALUE
        ? { [env.LLM_HEADER_NAME]: env.LLM_HEADER_VALUE }
        : undefined,
    timeout: 60_000,
    // Translations are latency-sensitive; the client queue owns retries.
    maxRetries: 0,
  });
  return client;
}

/**
 * vLLM-specific request fields. Qwen3 chat templates think by default; turning it off
 * saves latency and tokens. The SDK forwards unknown body fields as-is.
 */
export const VLLM_NO_THINKING = {
  chat_template_kwargs: { enable_thinking: false },
} as Record<string, unknown>;

export async function pingLlm(timeoutMs = 5_000): Promise<boolean> {
  try {
    await getLlm().models.list({ timeout: timeoutMs, maxRetries: 0 });
    return true;
  } catch {
    return false;
  }
}

/** Test hook. */
export function resetLlmClient() {
  client = undefined;
}
