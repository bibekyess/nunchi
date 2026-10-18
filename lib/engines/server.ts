// The `server` engine: the app's own /api/* routes, which call the GPU servers with
// server-side credentials. The shared passcode (APP_ACCESS_TOKEN) is kept in localStorage.
import type { z } from 'zod';
import {
  API_PATHS,
  apiErrorBodySchema,
  healthStatusSchema,
  transcriptionResultSchema,
  type HealthStatus,
} from '@/lib/api/contract';
import { encodeWav } from '@/lib/audio/wav';
import { ACCESS_TOKEN_HEADER, EngineError, type EngineErrorKind } from '@/lib/errors';
import { readString, writeString } from '@/lib/browser/storage';
import type { TranscriptionResult } from '@/lib/types';
import { withIdleTimeout } from '@/lib/util/streams';
import type {
  EngineProvider,
  EngineStatus,
  SpeechEngine,
  SummarizeRequest,
  SummaryEngine,
  TranscribeOptions,
  TranslateEngine,
  TranslateRequest,
} from './types';

const TOKEN_KEY = 'nunchi.accessToken';

export function getAccessToken(): string | null {
  return readString(TOKEN_KEY);
}

export function setAccessToken(token: string | null) {
  writeString(TOKEN_KEY, token || null);
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { [ACCESS_TOKEN_HEADER]: token } : {};
}

function kindOf(status: number, code: string): EngineErrorKind {
  if (code === 'not_configured') return 'unavailable';
  if (status === 0) return 'network';
  if (status === 401) return 'auth';
  if (status === 408 || status === 504) return 'timeout';
  // Rate limited: the server is busy, not the request wrong (as in the endpoint client).
  if (status === 429 || status >= 500) return 'upstream';
  return 'bad_request';
}

/** An error from one of the app's own /api/* routes. */
export class ApiError extends EngineError {
  constructor(
    public readonly status: number, // 0 = network failure
    public readonly code: string,
    message: string,
  ) {
    // Network failures, timeouts and 5xx are worth retrying; 4xx are not, and neither is a
    // server that has no upstream for the task.
    const retryable =
      code !== 'not_configured' &&
      (status === 0 || status === 408 || status === 429 || status >= 500);
    super(kindOf(status, code), message, { retryable, engine: 'server' });
    this.name = 'ApiError';
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = apiErrorBodySchema.safeParse(await res.json().catch(() => null));
  return body.success
    ? new ApiError(res.status, body.data.error.code, body.data.error.message)
    : new ApiError(res.status, 'http_error', `Request failed (${res.status})`);
}

/** Longest each call may take, answer and streamed body together. */
export const CALL_TIMEOUT_MS = {
  /** The server may call Speaches twice (language fallback), 30 s each at most. */
  transcribe: 90_000,
  translate: 150_000,
  /** A long meeting is summarized in parts before the merged answer starts streaming. */
  summarize: 20 * 60_000,
  health: 10_000,
} as const;

/**
 * Longest gap between streamed pieces. A backstop for a dead connection: the server's own
 * limits on the model (60 s per call, 30 s between pieces) are shorter and fail first.
 */
export const STREAM_IDLE_MS = 90_000;

/** The summary's first piece waits for the merge prompt to be processed (180 s upstream). */
const SUMMARY_FIRST_PIECE_MS = 210_000;

const timeoutError = (message = 'The app server did not answer in time.') =>
  new ApiError(408, 'timeout', message);

/** One request to the app server, with its own time limit. */
interface Call {
  res: Response;
  /** Stops the request, body included. */
  abort: () => void;
  /** Whether the time limit stopped it. */
  timedOut: () => boolean;
  /** Clears the time limit; call once the body has been read. */
  done: () => void;
}

/**
 * Sends a request that fails with a retryable timeout once `timeoutMs` pass, answer and body
 * together. A cancel through `init.signal` still rejects with the AbortError.
 */
async function send(url: string, init: RequestInit, timeoutMs: number): Promise<Call> {
  const own = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    own.abort(new DOMException('The app server did not answer in time.', 'TimeoutError'));
  }, timeoutMs);
  const done = () => clearTimeout(timer);
  const signal = init.signal ? AbortSignal.any([init.signal, own.signal]) : own.signal;
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal, headers: { ...authHeaders(), ...init.headers } });
  } catch (err) {
    done();
    if (timedOut) throw timeoutError();
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'Network error');
  }
  if (!res.ok) {
    done();
    throw await toApiError(res);
  }
  return { res, abort: () => own.abort(), timedOut: () => timedOut, done };
}

/**
 * Reads a JSON answer within the call's time limit and checks it against the contract, so an
 * answer this version doesn't understand (e.g. a newer server) fails here, not later on.
 */
async function readJson<S extends z.ZodType>(call: Call, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await call.res.json();
  } catch (err) {
    if (call.timedOut()) throw timeoutError();
    if ((err as Error)?.name === 'AbortError') throw err;
    raw = undefined; // not JSON: rejected below
  } finally {
    call.done();
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      call.res.status,
      'bad_response',
      'The app server sent an unexpected answer.',
    );
  }
  return parsed.data;
}

async function transcribeClip(audio: Blob, opts: TranscribeOptions): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append('audio', audio, 'clip.wav');
  form.append('language', opts.language);
  if (opts.prompt) form.append('prompt', opts.prompt);
  const call = await send(
    API_PATHS.transcribe,
    { method: 'POST', body: form, signal: opts.signal },
    CALL_TIMEOUT_MS.transcribe,
  );
  return readJson(call, transcriptionResultSchema);
}

async function* chunks(reader: ReadableStreamDefaultReader<Uint8Array>) {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}

/**
 * Reads a plain-text streamed response, calling onDelta for each piece. Resolves with the full
 * text. A body that stops arriving for `STREAM_IDLE_MS` (`firstMs` for the first piece) fails
 * with a retryable timeout and is cancelled.
 */
async function readTextStream(
  call: Call,
  onDelta: (delta: string) => void,
  what: string,
  { signal, firstMs }: { signal?: AbortSignal; firstMs?: number } = {},
): Promise<string> {
  const { res } = call;
  if (!res.body) {
    call.done();
    return '';
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  const emit = (text: string) => {
    if (!text) return;
    full += text;
    onDelta(text);
  };
  try {
    const pieces = withIdleTimeout(chunks(reader), STREAM_IDLE_MS, {
      firstMs,
      signal,
      onTimeout: () => {
        call.abort();
        reader.cancel().catch(() => {});
      },
      error: () => timeoutError(`The ${what.toLowerCase()} stopped arriving.`),
    });
    for await (const bytes of pieces) emit(decoder.decode(bytes, { stream: true }));
  } catch (err) {
    if (err instanceof EngineError) throw err; // the idle limit
    if (call.timedOut()) throw timeoutError();
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiError(0, 'stream_interrupted', `${what} stream was interrupted`);
  } finally {
    call.done();
  }
  emit(decoder.decode());
  return full;
}

/** Streams the translation, calling onDelta for each piece. Resolves with the full text. */
async function translateStream(
  body: TranslateRequest,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const call = await send(
    API_PATHS.translate,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    },
    CALL_TIMEOUT_MS.translate,
  );
  return readTextStream(call, onDelta, 'Translation', { signal });
}

/** Streams the markdown summary. Resolves with the full text. */
async function summarizeStream(
  body: SummarizeRequest,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const call = await send(
    API_PATHS.summarize,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    },
    CALL_TIMEOUT_MS.summarize,
  );
  return readTextStream(call, onDelta, 'Summary', { signal, firstMs: SUMMARY_FIRST_PIECE_MS });
}

/** Health results are shared by the three engines for this long, so one check serves all. */
const HEALTH_TTL_MS = 2_000;
let health: { at: number; result: Promise<HealthStatus> } | null = null;

export async function fetchHealth(): Promise<HealthStatus> {
  const call = await send(API_PATHS.health, { cache: 'no-store' }, CALL_TIMEOUT_MS.health);
  return readJson(call, healthStatusSchema);
}

/** One /api/health call for all server engines checked together. */
function sharedHealth(): Promise<HealthStatus> {
  const now = Date.now();
  if (!health || now - health.at > HEALTH_TTL_MS) {
    const result = fetchHealth();
    health = { at: now, result };
    // A failed check must not be reused.
    result.catch(() => {
      if (health?.result === result) health = null;
    });
  }
  return health.result;
}

/** Test hook. */
export function resetServerHealth() {
  health = null;
}

async function serviceStatus(service: keyof HealthStatus): Promise<EngineStatus> {
  try {
    const h = await sharedHealth();
    if (h[service] === 'ok') return { state: 'ready' };
    if (h[service] === 'not_configured') return { state: 'not_configured' };
    return { state: 'error', reason: 'The server is not answering.' };
  } catch (err) {
    if (err instanceof EngineError && err.kind === 'auth') {
      return { state: 'error', reason: 'Passcode required.', needsPasscode: true };
    }
    return { state: 'error', reason: 'Could not reach the app server.' };
  }
}

export const serverSpeech: SpeechEngine = {
  id: 'server',
  needsNetwork: true,
  status: () => serviceStatus('speaches'),
  transcribe: (audio, opts) => transcribeClip(encodeWav(audio), opts),
};

export const serverTranslate: TranslateEngine = {
  id: 'server',
  needsNetwork: true,
  status: () => serviceStatus('llm'),
  translate: translateStream,
};

export const serverSummary: SummaryEngine = {
  id: 'server',
  needsNetwork: true,
  status: () => serviceStatus('llm'),
  summarize: summarizeStream,
};

/** The app's own server; its engines don't depend on any settings. */
export const serverProvider: EngineProvider = {
  id: 'server',
  label: 'Server',
  built: true,
  speech: () => serverSpeech,
  translate: () => serverTranslate,
  summary: () => serverSummary,
};
