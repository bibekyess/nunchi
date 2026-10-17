// A small client for any OpenAI-compatible server (vLLM, Ollama, LM Studio, Speaches, …).
// fetch only, so it runs in the browser (custom endpoints) and on the server alike.
import { EngineError, type EngineErrorKind } from '@/lib/errors';
import type { EngineId } from '@/lib/engines/types';
import { normalizeWhisperLanguage } from '@/lib/languages';
import type { TranscriptionResult } from '@/lib/types';
import type { ChatMessage, ChatModel, ChatOptions, ChatStream, SpeechModel } from './models';

export const DEFAULT_CHAT_TIMEOUT_MS = 60_000;
export const DEFAULT_SPEECH_TIMEOUT_MS = 30_000;
export const MODELS_TIMEOUT_MS = 5_000;

/**
 * vLLM request fields that turn off Qwen3's reasoning, which its chat template enables by
 * default; saves latency and tokens. Other servers ignore unknown fields.
 */
export const VLLM_NO_THINKING: Record<string, unknown> = {
  chat_template_kwargs: { enable_thinking: false },
};

export interface OpenAICompatibleConfig {
  /** e.g. `http://localhost:11434/v1`; trailing slashes are ignored. */
  baseUrl: string;
  model: string;
  /** Sent as `Authorization: Bearer …` when set. */
  apiKey?: string;
  /** Extra headers on every request (e.g. a gateway's own auth header). */
  headers?: Record<string, string>;
  /** Extra fields merged into every chat request body (e.g. vLLM `chat_template_kwargs`). */
  extraBody?: Record<string, unknown>;
  /** Time allowed until the response starts, unless a call overrides it. */
  timeoutMs?: number;
  /** Tags errors with the engine they came from. */
  engine?: EngineId;
  /** Test hook. */
  fetch?: typeof fetch;
}

/**
 * A failed request. `message` is safe to show to the user; `detail` (the server's response
 * body, or the low-level error) is for logs only, since it may echo secrets.
 */
export class EndpointError extends EngineError {
  constructor(
    kind: EngineErrorKind,
    message: string,
    public readonly status?: number,
    public readonly detail?: string,
    engine?: EngineId,
  ) {
    super(kind, message, { engine });
    this.name = 'EndpointError';
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function kindOfStatus(status: number): EngineErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 429 || status >= 500) return 'upstream';
  return 'bad_request';
}

function messageOfStatus(status: number, host: string): string {
  if (status === 401 || status === 403) return `${host} refused the API key (${status}).`;
  if (status === 404) return `${host} has no such model or path (404).`;
  if (status === 408 || status === 504) return `${host} did not answer in time.`;
  return `${host} returned an error (${status}).`;
}

function isAbortError(err: unknown): boolean {
  return (err as Error)?.name === 'AbortError';
}

/** Turns a fetch Response into a successful one or an `EndpointError`. */
async function checkResponse(res: Response, url: string, engine?: EngineId): Promise<Response> {
  if (res.ok) return res;
  const detail = await res.text().catch(() => '');
  throw new EndpointError(
    kindOfStatus(res.status),
    messageOfStatus(res.status, hostOf(url)),
    res.status,
    detail,
    engine,
  );
}

/**
 * Splits a server-sent events body into `data` payloads. Handles events split across chunks,
 * several events per chunk, CRLF or CR line endings, comment lines (keep-alives) and
 * multi-line data. Stops at `[DONE]`.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];

  // Returns the payload when `line` ends an event, else null.
  const takeLine = (line: string): string | null => {
    if (line === '') {
      if (data.length === 0) return null;
      const payload = data.join('\n');
      data = [];
      return payload;
    }
    if (line.startsWith(':')) return null; // comment / keep-alive
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    return null;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // A '\r' at the very end may be half of '\r\n'; keep it until more arrives.
      const held = !done && buffer.endsWith('\r') ? 1 : 0;
      const lines = buffer
        .slice(0, buffer.length - held)
        .replace(/\r\n?/g, '\n')
        .split('\n');
      // The last piece is an unfinished line, unless the body ended (then it ends the event).
      buffer = done ? '' : lines.pop()! + buffer.slice(buffer.length - held);
      if (done) lines.push('');
      for (const line of lines) {
        const payload = takeLine(line);
        if (payload === null) continue;
        if (payload === '[DONE]') return;
        yield payload;
      }
      if (done) return;
    }
  } finally {
    // Stops the download when the consumer stops early or [DONE] arrives.
    reader.cancel().catch(() => {});
  }
}

interface ChatChunk {
  choices?: { delta?: { content?: string | null } }[];
  error?: unknown;
}

interface ChatCompletion {
  choices?: { message?: { content?: string | null } }[];
}

interface VerboseJson {
  text?: string;
  language?: string;
  duration?: number;
  segments?: { text?: string; no_speech_prob?: number; avg_logprob?: number }[];
}

/**
 * Maps an OpenAI-style transcription (`verbose_json`, or plain `json` with only `text`) to
 * ours. Missing segment scores read as "confident speech", so the no-speech filter only acts
 * on servers that report them.
 */
export function parseTranscription(data: VerboseJson): TranscriptionResult {
  return {
    text: (data.text ?? '').trim(),
    language: normalizeWhisperLanguage(data.language),
    durationMs: Math.round((data.duration ?? 0) * 1000),
    segments: (data.segments ?? []).map((s) => ({
      text: (s.text ?? '').trim(),
      noSpeechProb: s.no_speech_prob ?? 0,
      avgLogprob: s.avg_logprob ?? 0,
    })),
  };
}

export interface OpenAICompatibleClient {
  readonly config: OpenAICompatibleConfig;
  chat: ChatModel;
  speech: SpeechModel;
  /** Model ids from `GET /models`. */
  listModels(opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<string[]>;
}

export function createOpenAICompatible(config: OpenAICompatibleConfig): OpenAICompatibleClient {
  const base = config.baseUrl.replace(/\/+$/, '');
  const doFetch = config.fetch ?? ((input, init) => fetch(input, init));
  const host = hostOf(base);
  const engine = config.engine;

  function headers(extra?: Record<string, string>): Record<string, string> {
    return {
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      ...config.headers,
      ...extra,
    };
  }

  /**
   * One request. The timeout covers the wait for the response to start (as the OpenAI SDK
   * does); once a stream is flowing only `signal` and `abort` stop it. Rejects with an
   * AbortError when `signal` aborts, so callers can tell a cancel from a failure. Call
   * `release` once the body has been read.
   */
  async function request(
    path: string,
    init: RequestInit,
    { signal, timeoutMs }: { signal?: AbortSignal; timeoutMs: number },
  ): Promise<{ res: Response; abort: () => void; release: () => void }> {
    const url = `${base}${path}`;
    const own = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      own.abort();
    }, timeoutMs);
    const onAbort = () => own.abort();
    if (signal?.aborted) own.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => signal?.removeEventListener('abort', onAbort);

    let res: Response;
    try {
      res = await doFetch(url, { ...init, signal: own.signal });
    } catch (err) {
      cleanup();
      if (timedOut) {
        throw new EndpointError(
          'timeout',
          `${host} did not answer in time.`,
          undefined,
          'TimeoutError',
          engine,
        );
      }
      if (signal?.aborted || isAbortError(err)) throw err;
      // fetch rejects without a status for DNS failures, refused connections, CORS blocks
      // and mixed content alike; the browser does not say which.
      throw new EndpointError(
        'network',
        `Couldn't reach ${host}. Check the URL, that the server is running, and that it allows this site (CORS).`,
        undefined,
        String(err),
        engine,
      );
    } finally {
      clearTimeout(timer);
    }
    try {
      await checkResponse(res, url, engine);
    } catch (err) {
      cleanup();
      throw err;
    }
    return {
      res,
      abort: () => {
        cleanup();
        own.abort();
      },
      release: cleanup,
    };
  }

  /** Reads a JSON body, then lets go of the caller's signal. */
  async function readJson<T>(
    { res, release }: { res: Response; release: () => void },
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) throw err;
      throw new EndpointError(
        'upstream',
        `${host} sent a response that isn't JSON.`,
        res.status,
        String(err),
        engine,
      );
    } finally {
      release();
    }
  }

  function chatBody(messages: ChatMessage[], opts: ChatOptions, stream: boolean) {
    return JSON.stringify({
      model: config.model,
      messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      ...(stream ? { stream: true } : {}),
      ...config.extraBody,
    });
  }

  const timeoutFor = (opts: { timeoutMs?: number }, fallback: number) =>
    opts.timeoutMs ?? config.timeoutMs ?? fallback;

  const chat: ChatModel = {
    async stream(messages, opts): Promise<ChatStream> {
      const { res, abort, release } = await request(
        '/chat/completions',
        {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
          body: chatBody(messages, opts, true),
        },
        { signal: opts.signal, timeoutMs: timeoutFor(opts, DEFAULT_CHAT_TIMEOUT_MS) },
      );
      const body = res.body;
      return {
        async *[Symbol.asyncIterator]() {
          if (!body) return;
          try {
            for await (const payload of parseSse(body)) {
              let chunk: ChatChunk;
              try {
                chunk = JSON.parse(payload) as ChatChunk;
              } catch {
                continue; // not JSON (some servers send stray lines); skip it
              }
              if (chunk.error) {
                throw new EndpointError(
                  'upstream',
                  `${host} reported an error mid-answer.`,
                  undefined,
                  JSON.stringify(chunk.error),
                  engine,
                );
              }
              const content = chunk.choices?.[0]?.delta?.content;
              if (content) yield content;
            }
          } catch (err) {
            if (err instanceof EngineError || opts.signal?.aborted || isAbortError(err)) throw err;
            throw new EndpointError(
              'network',
              `The answer from ${host} broke off.`,
              undefined,
              String(err),
              engine,
            );
          } finally {
            release();
          }
        },
        abort,
      };
    },

    async complete(messages, opts) {
      const response = await request(
        '/chat/completions',
        {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: chatBody(messages, opts, false),
        },
        { signal: opts.signal, timeoutMs: timeoutFor(opts, DEFAULT_CHAT_TIMEOUT_MS) },
      );
      const data = await readJson<ChatCompletion>(response, opts.signal);
      return data.choices?.[0]?.message?.content ?? '';
    },
  };

  const speech: SpeechModel = {
    async transcribe(wav, opts = {}) {
      const form = new FormData();
      form.append('file', wav, 'clip.wav');
      form.append('model', config.model);
      if (opts.language) form.append('language', opts.language);
      if (opts.prompt) form.append('prompt', opts.prompt);
      form.append('temperature', '0');
      form.append('response_format', 'verbose_json');
      const response = await request(
        '/audio/transcriptions',
        { method: 'POST', headers: headers(), body: form },
        { signal: opts.signal, timeoutMs: config.timeoutMs ?? DEFAULT_SPEECH_TIMEOUT_MS },
      );
      return parseTranscription(await readJson<VerboseJson>(response, opts.signal));
    },
  };

  async function listModels({
    signal,
    timeoutMs = MODELS_TIMEOUT_MS,
  }: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<string[]> {
    const response = await request(
      '/models',
      { method: 'GET', headers: headers() },
      { signal, timeoutMs },
    );
    const data = await readJson<{ data?: unknown }>(response, signal);
    if (!Array.isArray(data?.data)) {
      throw new EndpointError(
        'bad_request',
        `${host} has no model list at /models. Is this an OpenAI-compatible URL (often ending in /v1)?`,
        response.res.status,
        undefined,
        engine,
      );
    }
    return (data.data as { id?: unknown }[])
      .map((m) => m?.id)
      .filter((id): id is string => typeof id === 'string');
  }

  return { config, chat, speech, listModels };
}
