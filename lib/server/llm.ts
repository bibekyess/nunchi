import 'server-only';
import type { ChatModel } from '@/lib/core/models';
import {
  createOpenAICompatible,
  VLLM_NO_THINKING,
  type OpenAICompatibleClient,
} from '@/lib/core/openai-compatible';
import { getEnv, isConfigured } from './env';
import { NotConfiguredError } from './http';

/** Default time allowed until a response starts; summaries ask for longer per call. */
const LLM_TIMEOUT_MS = 60_000;

let client: OpenAICompatibleClient | undefined;

/**
 * Client for the self-hosted vLLM Qwen server. It never retries on its own (translations are
 * latency-sensitive; the browser's job queue owns retries). Qwen3 chat templates think by
 * default, so every request turns that off to save latency and tokens.
 */
function getLlm(): OpenAICompatibleClient {
  if (client) return client;
  const env = getEnv();
  if (!isConfigured('llm', env)) throw new NotConfiguredError('llm');
  client = createOpenAICompatible({
    baseUrl: env.LLM_BASE_URL!,
    model: env.LLM_MODEL!,
    // Sent even when it is the "none" placeholder, as the OpenAI SDK did before.
    apiKey: env.LLM_API_KEY,
    headers:
      env.LLM_HEADER_NAME && env.LLM_HEADER_VALUE
        ? { [env.LLM_HEADER_NAME]: env.LLM_HEADER_VALUE }
        : undefined,
    extraBody: VLLM_NO_THINKING,
    timeoutMs: LLM_TIMEOUT_MS,
  });
  return client;
}

/** The vLLM Qwen server as a `ChatModel`, with reasoning turned off. */
export const serverChat: ChatModel = {
  stream: (messages, opts) => getLlm().chat.stream(messages, opts),
  complete: (messages, opts) => getLlm().chat.complete(messages, opts),
};

export async function pingLlm(timeoutMs = 5_000): Promise<boolean> {
  try {
    await getLlm().listModels({ timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/** Test hook. */
export function resetLlmClient() {
  client = undefined;
}
