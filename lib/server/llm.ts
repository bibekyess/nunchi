import 'server-only';
import OpenAI from 'openai';
import type { ChatMessage, ChatModel, ChatOptions } from '@/lib/core/models';
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

function requestFields(messages: ChatMessage[], opts: ChatOptions) {
  return {
    model: getEnv().LLM_MODEL,
    messages,
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
    ...VLLM_NO_THINKING,
  };
}

function requestOptions(opts: ChatOptions) {
  return {
    signal: opts.signal,
    // Only override the client's default when asked to.
    ...(opts.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}),
  };
}

/** The vLLM Qwen server as a `ChatModel`, with reasoning turned off. */
export const serverChat: ChatModel = {
  async stream(messages, opts) {
    const upstream = await getLlm().chat.completions.create(
      { ...requestFields(messages, opts), stream: true },
      requestOptions(opts),
    );
    return {
      async *[Symbol.asyncIterator]() {
        for await (const chunk of upstream) yield chunk.choices[0]?.delta?.content ?? '';
      },
      abort: () => upstream.controller.abort(),
    };
  },

  async complete(messages, opts) {
    const res = await getLlm().chat.completions.create(
      requestFields(messages, opts),
      requestOptions(opts),
    );
    return res.choices[0]?.message?.content ?? '';
  },
};

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
