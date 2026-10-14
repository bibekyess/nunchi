import 'server-only';
import type { ApiErrorBody } from '@/lib/types';

export type ErrorCode =
  | 'unauthorized'
  | 'bad_request'
  | 'payload_too_large'
  | 'upstream_error'
  | 'upstream_timeout'
  | 'server_misconfigured'
  | 'internal_error';

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  bad_request: 400,
  payload_too_large: 413,
  upstream_error: 502,
  upstream_timeout: 504,
  server_misconfigured: 500,
  internal_error: 500,
};

export function jsonError(code: ErrorCode, message: string): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return Response.json(body, { status: STATUS[code] });
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
  return (
    err instanceof Error &&
    (err.name === 'TimeoutError' || err.name === 'APIConnectionTimeoutError')
  );
}

/** Map anything thrown inside a route to a safe JSON error and log the detail. */
export function errorResponse(route: string, err: unknown): Response {
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
