import 'server-only';
import type { z } from 'zod';
import { EndpointError } from '@/lib/core/openai-compatible';
import { EngineError } from '@/lib/errors';
import type { ApiErrorBody } from '@/lib/types';
import { withIdleTimeout } from '@/lib/util/streams';
import type { Service } from './env';
import { logTiming, ms, type Field } from './timing';

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

/** Parses and validates a JSON body; on failure returns the 400 response to send. */
export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ data: z.output<S>; error?: undefined } | { data?: undefined; error: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
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
  route: string;
  text: AsyncIterable<string>;
  /** Stops the upstream request when the client goes away. */
  abort: () => void;
  signal: AbortSignal;
  /** Milliseconds since the request started. */
  elapsed: () => number;
  /** Log fields for every outcome, in log order; `ttft` and `total` are filled in here. */
  fields: (t: { ttft: Field; total: Field }) => Record<string, Field>;
  /** Extra log fields on success, given the number of characters sent. */
  okFields?: (outChars: number) => Record<string, Field>;
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
  route,
  text,
  abort,
  signal,
  elapsed,
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
      const timings = () => fields({ ttft: ms(ttftMs), total: ms(elapsed()) });
      const pieces = withIdleTimeout(text, idleMs, {
        firstMs,
        signal,
        onTimeout: abort,
        error: () => new EngineError('timeout', `The ${route} stream stalled.`),
      });
      try {
        for await (const piece of pieces) {
          if (!piece) continue;
          ttftMs ??= elapsed();
          outChars += piece.length;
          controller.enqueue(encoder.encode(piece));
        }
        logTiming(route, 'ok', { ...timings(), ...okFields?.(outChars) });
        controller.close();
      } catch (err) {
        if (signal.aborted) {
          logTiming(route, 'aborted', timings());
          controller.close();
          return;
        }
        const e = toUpstreamError(err);
        logTiming(route, 'error', timings());
        console.error(`[${route}] stream failed: ${e.message}`, e.detail?.slice(0, 500) ?? '');
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

/** Map anything thrown inside a route to a safe JSON error and log the detail. */
export function errorResponse(route: string, err: unknown): Response {
  if (err instanceof NotConfiguredError) return notConfigured(err.service);
  if (err instanceof UpstreamError) {
    console.error(
      `[${route}] ${err.message}`,
      err.detail ? `detail: ${err.detail.slice(0, 500)}` : '',
    );
    return jsonError(
      err.code,
      err.code === 'upstream_timeout'
        ? `The ${err.service} server did not answer in time.`
        : `The ${err.service} server returned an error.`,
    );
  }
  if (err instanceof Error && err.message.startsWith('Invalid server environment')) {
    console.error(`[${route}] ${err.message}`);
    return jsonError('server_misconfigured', 'The server is missing configuration.');
  }
  console.error(`[${route}] unexpected error`, err);
  return jsonError('internal_error', 'Unexpected server error.');
}
