import { ACCESS_TOKEN_HEADER, EngineError, type EngineErrorKind } from './errors';
import { readString, writeString } from './storage';
import type {
  ApiErrorBody,
  GlossaryEntry,
  Lang,
  TranscriptionResult,
  TranslationContextItem,
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

export async function transcribeClip(
  audio: Blob,
  opts: { language: Lang | 'auto'; prompt?: string; signal?: AbortSignal },
): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append('audio', audio, 'clip.wav');
  form.append('language', opts.language);
  if (opts.prompt) form.append('prompt', opts.prompt);
  const res = await send('/api/transcribe', { method: 'POST', body: form, signal: opts.signal });
  return (await res.json()) as TranscriptionResult;
}

export interface TranslateRequest {
  text: string;
  sourceLang: Lang;
  targetLang: Lang;
  context: TranslationContextItem[];
  glossary: GlossaryEntry[];
  meetingContext?: string;
  /** Second attempt: the server answers deterministically (temperature 0). */
  retry?: boolean;
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
export async function translateStream(
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

export interface SummarizeRequest {
  utterances: { seq: number; sourceText: string; translation?: string }[];
  glossary: GlossaryEntry[];
  meetingContext?: string;
  outputLang: Lang;
}

/** Streams the markdown summary. Resolves with the full text. */
export async function summarizeStream(
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

export type HealthStatus = { speaches: 'ok' | 'error'; llm: 'ok' | 'error' };

export async function fetchHealth(): Promise<HealthStatus> {
  const res = await send('/api/health', { cache: 'no-store' });
  return (await res.json()) as HealthStatus;
}
