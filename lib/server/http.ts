import 'server-only';
import type { z } from 'zod';
import { EndpointError } from '@/lib/core/openai-compatible';
import { EngineError } from '@/lib/errors';
import type { ApiErrorBody } from '@/lib/api/contract';
import { withIdleTimeout } from '@/lib/util/streams';
import type { Service } from './env';
import type { Fields, RequestLog } from './log';

export type ErrorCode =
  | 'unauthorized'
  | 'bad_request'
  | 'payload_too_large'
  | 'upstream_error'
  | 'upstream_timeout'
  | 'server_misconfigured'
  | 'not_configured'
  | 'internal_error';

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  bad_request: 400,
  payload_too_large: 413,
  upstream_error: 502,
  upstream_timeout: 504,
  server_misconfigured: 500,
  not_configured: 503,
  internal_error: 500,
};

export function jsonError(code: ErrorCode, message: string): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return Response.json(body, { status: STATUS[code] });
}

const NOT_CONFIGURED: Record<Service, string> = {
  speaches: 'Speech-to-text is not set up on this server.',
  llm: 'Translation and summaries are not set up on this server.',
};

/** This deployment has no upstream for the service (its env vars are empty). */
export class NotConfiguredError extends Error {
  constructor(public readonly service: Service) {
    super(`${service} not configured`);
    this.name = 'NotConfiguredError';
  }
}

/** 503 for a route whose upstream this deployment doesn't have. */
export function notConfigured(service: Service): Response {
  return jsonError('not_configured', NOT_CONFIGURED[service]);
}

/** An upstream call failed. `detail` is logged server-side only, never sent to the client. */
export class UpstreamError extends Error {
  constructor(
    public readonly service: 'speaches' | 'llm',
    public readonly code: 'upstream_error' | 'upstream_timeout',
    public readonly status: number | undefined,
    public readonly detail?: string,
  ) {
    super(`${service} ${code}${status ? ` (${status})` : ''}`);
    this.name = 'UpstreamError';
  }
}

export function isTimeoutError(err: unknown): boolean {
  if (err instanceof EngineError) return err.kind === 'timeout';
  return err instanceof Error && err.name === 'TimeoutError';
}

/** Wraps anything an upstream call threw as an `UpstreamError`, keeping the detail for logs. */
export function toUpstreamError(
  err: unknown,
  service: UpstreamError['service'] = 'llm',
): UpstreamError {
  if (err instanceof UpstreamError) return err;
  if (isTimeoutError(err)) return new UpstreamError(service, 'upstream_timeout', undefined);
  const status = (err as { status?: number })?.status;
  // An endpoint error keeps the server's response body apart from its user-facing message.
  const detail =
    err instanceof EndpointError && err.detail ? `${err.message} ${err.detail}` : String(err);
  return new UpstreamError(service, 'upstream_error', status, detail);
}

/**
 * Reads a request body of at most `maxBytes`, or returns null when it is larger: refused from
 * its Content-Length before reading anything, or as soon as a streamed body passes the limit.
 * Keeps one oversized request from filling the server's memory.
 */
export async function readBodyLimited(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return body;
}

/**
 * Parses and validates a JSON body of at most `maxBytes`; on failure returns the response to
 * send (413 when too large, 400 otherwise).
 */
export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  maxBytes: number,
): Promise<{ data: z.output<S>; error?: undefined } | { data?: undefined; error: Response }> {
  const body = await readBodyLimited(request, maxBytes);
  if (!body) return { error: jsonError('payload_too_large', 'The request is too large.') };
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return { error: jsonError('bad_request', 'Expected a JSON body.') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error: jsonError('bad_request', `${issue?.path.join('.') || 'body'}: ${issue?.message}`),
    };
  }
  return { data: parsed.data };
}

/**
 * Longest gap between pieces of a streamed answer. A backstop: the model client's own limits
 * (60 s per call, 30 s between pieces) are shorter, but the pipeline logic between them (e.g.
 * the translation's empty-answer retry) must not hang a response either.
 */
export const STREAM_IDLE_MS = 90_000;

export interface StreamTextOptions {
  /** The request's logger; `log.done` is called when the stream ends. */
  log: RequestLog;
  text: AsyncIterable<string>;
  /** Stops the upstream request when the client goes away. */
  abort: () => void;
  signal: AbortSignal;
  /** Log fields for every outcome, in log order; `ttftMs` is filled in here, `totalMs` by `done`. */
  fields: (t: { ttftMs: number | undefined }) => Fields;
  /** Extra log fields on success, given the number of characters sent. */
  okFields?: (outChars: number) => Fields;
  /** Longest gap between pieces (default `STREAM_IDLE_MS`). */
  idleMs?: number;
  /** Time allowed for the first piece (default `idleMs`). */
  firstMs?: number;
}

/**
 * Streams `text` as a plain-text response and logs one timing line when it ends. Errors after
 * the first byte can't become a JSON error any more; they end the stream and are logged. Text
 * that stops coming ends the response as an upstream timeout and stops the upstream.
 */
export function streamText({
  log,
  text,
  abort,
  signal,
  fields,
  okFields,
  idleMs = STREAM_IDLE_MS,
  firstMs,
}: StreamTextOptions): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let outChars = 0;
      let ttftMs: number | undefined;
      const pieces = withIdleTimeout(text, idleMs, {
        firstMs,
        signal,
        onTimeout: abort,
        error: () => new EngineError('timeout', `The ${log.route} stream stalled.`),
      });
      try {
        for await (const piece of pieces) {
          if (!piece) continue;
          ttftMs ??= log.elapsed();
          outChars += piece.length;
          controller.enqueue(encoder.encode(piece));
        }
        log.done('ok', { ...fields({ ttftMs }), ...okFields?.(outChars) });
        controller.close();
      } catch (err) {
        if (signal.aborted) {
          log.done('aborted', fields({ ttftMs }));
          controller.close();
          return;
        }
        const e = toUpstreamError(err);
        log.done('error', fields({ ttftMs }));
        log.error('stream failed', upstreamFields(e));
        controller.error(e);
      }
    },
    cancel() {
      abort();
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Longest text taken from an upstream error body or an error message into a log line. */
const MAX_DETAIL_CHARS = 500;
/** Longest stack trace in a log line. */
const MAX_STACK_CHARS = 2000;

export function truncate(text: string, max = MAX_DETAIL_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Replaces this server's own credentials in `text` with `[redacted]`. An upstream may echo the
 * request's auth header in its error body, and those bodies are logged.
 */
export function redactSecrets(text: string): string {
  const env = process.env;
  const secrets = [
    env.LLM_HEADER_VALUE,
    env.LLM_API_KEY === 'none' ? undefined : env.LLM_API_KEY,
    env.SPEACHES_API_KEY,
    env.APP_ACCESS_TOKEN,
  ]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));
  return secrets.reduce((out, secret) => out.split(secret).join('[redacted]'), text);
}

/** Text from outside (error bodies, messages) made safe and short enough to log. */
const detailField = (text: string | undefined, max?: number) =>
  text === undefined ? undefined : truncate(redactSecrets(text), max);

function upstreamFields(err: UpstreamError): Fields {
  return {
    service: err.service,
    code: err.code,
    status: err.status,
    detail: detailField(err.detail),
  };
}

/** Log fields for an unexpected error: its name, message and the start of its stack. */
export function errorFields(err: unknown): Fields {
  if (!(err instanceof Error)) return { errMessage: detailField(String(err)) };
  return {
    errName: err.name,
    errMessage: detailField(err.message),
    stack: detailField(err.stack, MAX_STACK_CHARS),
  };
}

/** Map anything thrown inside a route to a safe JSON error and log the detail. */
export function errorResponse(log: RequestLog, err: unknown): Response {
  if (err instanceof NotConfiguredError) return notConfigured(err.service);
  if (err instanceof UpstreamError) {
    log.error('upstream failed', upstreamFields(err));
    return jsonError(
      err.code,
      err.code === 'upstream_timeout'
        ? `The ${err.service} server did not answer in time.`
        : `The ${err.service} server returned an error.`,
    );
  }
  if (err instanceof Error && err.message.startsWith('Invalid server environment')) {
    log.error('invalid configuration', { errMessage: detailField(err.message) });
    return jsonError('server_misconfigured', 'The server is missing configuration.');
  }
  log.error('unexpected error', errorFields(err));
  return jsonError('internal_error', 'Unexpected server error.');
}
