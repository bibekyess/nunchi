// The `server` engine: the app's own /api/* routes, which call the GPU servers with
// server-side credentials. The shared passcode (APP_ACCESS_TOKEN) is kept in localStorage.
import { encodeWav } from '@/lib/audio/wav';
import { ACCESS_TOKEN_HEADER, EngineError, type EngineErrorKind } from '@/lib/errors';
import { readString, writeString } from '@/lib/storage';
import type { ApiErrorBody, TranscriptionResult } from '@/lib/types';
import type {
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

function kindOf(status: number): EngineErrorKind {
  if (status === 0) return 'network';
  if (status === 401) return 'auth';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'upstream';
  return 'bad_request';
}

/** An error from one of the app's own /api/* routes. */
export class ApiError extends EngineError {
  constructor(
    public readonly status: number, // 0 = network failure
    public readonly code: string,
    message: string,
  ) {
    // Network failures, timeouts and 5xx are worth retrying; 4xx are not.
    super(
      kindOf(status),
      message,
      status === 0 || status === 408 || status === 429 || status >= 500,
    );
    this.name = 'ApiError';
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    return new ApiError(res.status, body.error.code, body.error.message);
  } catch {
    return new ApiError(res.status, 'http_error', `Request failed (${res.status})`);
  }
}

async function send(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { ...authHeaders(), ...init.headers } });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'Network error');
  }
  if (!res.ok) throw await toApiError(res);
  return res;
}

async function transcribeClip(audio: Blob, opts: TranscribeOptions): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append('audio', audio, 'clip.wav');
  form.append('language', opts.language);
  if (opts.prompt) form.append('prompt', opts.prompt);
  const res = await send('/api/transcribe', { method: 'POST', body: form, signal: opts.signal });
  return (await res.json()) as TranscriptionResult;
}

/** Reads a plain-text streamed response, calling onDelta for each piece. Resolves with the full text. */
async function readTextStream(
  res: Response,
  onDelta: (delta: string) => void,
  what: string,
): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) {
        full += text;
        onDelta(text);
      }
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiError(0, 'stream_interrupted', `${what} stream was interrupted`);
  }
  const tail = decoder.decode();
  if (tail) {
    full += tail;
    onDelta(tail);
  }
  return full;
}

/** Streams the translation, calling onDelta for each piece. Resolves with the full text. */
async function translateStream(
  body: TranslateRequest,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await send('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return readTextStream(res, onDelta, 'Translation');
}

/** Streams the markdown summary. Resolves with the full text. */
async function summarizeStream(
  body: SummarizeRequest,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await send('/api/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return readTextStream(res, onDelta, 'Summary');
}

export type ServiceHealth = 'ok' | 'error';
export type HealthStatus = { speaches: ServiceHealth; llm: ServiceHealth };

/** Health results are shared by the three engines for this long, so one check serves all. */
const HEALTH_TTL_MS = 2_000;
let health: { at: number; result: Promise<HealthStatus> } | null = null;

export async function fetchHealth(): Promise<HealthStatus> {
  const res = await send('/api/health', { cache: 'no-store' });
  return (await res.json()) as HealthStatus;
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
    return h[service] === 'ok'
      ? { state: 'ready' }
      : { state: 'error', reason: 'The server is not answering.' };
  } catch (err) {
    if (err instanceof EngineError && err.kind === 'auth') {
      return { state: 'error', reason: 'Passcode required.' };
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
