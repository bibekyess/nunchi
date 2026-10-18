import 'server-only';
import { errorResponse } from './http';

/**
 * Server logs: one line per event, JSON lines in production (for a log collector) and short
 * readable lines otherwise. `LOG_FORMAT=json|pretty` and `LOG_LEVEL=debug|info|warn|error`
 * override the defaults. Both are read from `process.env` on every call, not through
 * `getEnv()`, so logging still works while the env is invalid.
 *
 * Only pass numbers and short labels as fields, never transcript, prompt, header or body text.
 */

export type Fields = Record<string, string | number | boolean | undefined>;

export type Level = 'debug' | 'info' | 'warn' | 'error';

export type Outcome = 'ok' | 'error' | 'aborted';

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Field keys that may hold a credential are dropped whatever their value. */
const SECRET_KEY = /authorization|token|secret|password|api[-_]?key/i;

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  /** A logger that adds `fields` to every line. */
  child(fields: Fields): Logger;
}

export interface RequestLog extends Logger {
  readonly id: string;
  readonly route: string;
  /** Milliseconds since the request started. */
  elapsed(): number;
  /**
   * Logs the request's one summary line (`totalMs` added here); later calls are ignored.
   * An error is logged at warn, other outcomes at info.
   */
  done(outcome: Outcome, fields?: Fields): void;
}

/** Returns a function that reports the whole milliseconds elapsed since the call. */
export function startTimer(): () => number {
  const t0 = performance.now();
  return () => Math.round(performance.now() - t0);
}

function format(): 'json' | 'pretty' {
  const f = process.env.LOG_FORMAT?.trim().toLowerCase();
  if (f === 'json' || f === 'pretty') return f;
  return process.env.NODE_ENV === 'production' ? 'json' : 'pretty';
}

function minLevel(): Level {
  const l = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (l && l in RANK) return l as Level;
  return process.env.NODE_ENV === 'development' ? 'debug' : 'info';
}

/** Undefined, empty and secret-looking fields are left out. */
function clean(fields: Fields): [string, string | number | boolean][] {
  return Object.entries(fields).filter(
    (e): e is [string, string | number | boolean] =>
      e[1] !== undefined && e[1] !== '' && !SECRET_KEY.test(e[0]),
  );
}

/** `openMs: 120` reads as `open=120ms`, `outChars` as `out=…ch`, `sizeKb` as `size=…KB`. */
function prettyField(key: string, value: string | number | boolean): string {
  if (typeof value === 'number') {
    const unit = /^(.+)(Ms|Chars|Kb)$/.exec(key);
    if (unit) return `${unit[1]}=${value}${{ Ms: 'ms', Chars: 'ch', Kb: 'KB' }[unit[2]]}`;
  }
  const text = String(value);
  return `${key}=${/[\s"=]/.test(text) ? JSON.stringify(text) : text}`;
}

/** `[route] msg key=value … rid=…`, with multi-line values (stacks) on the lines below. */
function pretty(base: Fields, msg: string, fields: Fields): string {
  const { route, scope, rid, ...rest } = base;
  const words = [`[${route ?? scope ?? 'nunchi'}]`, msg];
  const blocks: string[] = [];
  for (const [key, value] of clean({ ...rest, ...fields, rid })) {
    if (typeof value === 'string' && value.includes('\n')) blocks.push(value);
    else words.push(prettyField(key, value));
  }
  return [words.join(' '), ...blocks].join('\n');
}

function json(level: Level, base: Fields, msg: string, fields: Fields): string {
  const line = { time: new Date().toISOString(), level, ...base, msg, ...fields };
  return JSON.stringify(Object.fromEntries(clean(line)));
}

function write(level: Level, base: Fields, msg: string, fields: Fields = {}): void {
  if (RANK[level] < RANK[minLevel()]) return;
  const line = format() === 'json' ? json(level, base, msg, fields) : pretty(base, msg, fields);
  console[level](line);
}

export function createLogger(base: Fields = {}): Logger {
  return {
    debug: (msg, fields) => write('debug', base, msg, fields),
    info: (msg, fields) => write('info', base, msg, fields),
    warn: (msg, fields) => write('warn', base, msg, fields),
    error: (msg, fields) => write('error', base, msg, fields),
    child: (fields) => createLogger({ ...base, ...fields }),
  };
}

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** The proxy's `x-request-id` when it looks like an id, else a new one. */
export function requestIdFrom(request: Request): string {
  const given = request.headers.get('x-request-id');
  return given && REQUEST_ID.test(given) ? given : crypto.randomUUID();
}

/** The logger for one request; `withRequestLog` makes one per request. */
export function createRequestLog(
  route: string,
  id: string = crypto.randomUUID(),
): RequestLog & { readonly finished: boolean } {
  const elapsed = startTimer();
  const log = createLogger({ route, rid: id });
  const self = {
    ...log,
    id,
    route,
    elapsed,
    finished: false,
    done(outcome: Outcome, fields: Fields = {}) {
      if (self.finished) return;
      self.finished = true;
      const line = { ...fields, totalMs: elapsed() };
      if (outcome === 'error') log.warn(outcome, line);
      else log.info(outcome, line);
    },
  };
  return self;
}

/** Sets the request id on a response, copying it when its headers can't be changed. */
function withRequestId(response: Response, id: string): Response {
  try {
    response.headers.set('x-request-id', id);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    copy.headers.set('x-request-id', id);
    return copy;
  }
}

/**
 * Wraps a route handler: gives it a logger tagged with the request id, sends that id back as
 * `x-request-id`, and logs requests that ended without `log.done` (refused or invalid ones at
 * info, successful ones at debug so health polling stays quiet). Anything the handler throws
 * becomes a JSON 500. The logger is passed explicitly rather than kept in AsyncLocalStorage.
 */
export function withRequestLog(
  route: string,
  handler: (request: Request, log: RequestLog) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const log = createRequestLog(route, requestIdFrom(request));
    let response: Response;
    try {
      response = await handler(request, log);
    } catch (err) {
      response = errorResponse(log, err);
    }
    if (!log.finished) {
      const fields = { status: response.status, totalMs: log.elapsed() };
      if (response.ok) log.debug('response', fields);
      else log.info('response', fields);
    }
    return withRequestId(response, log.id);
  };
}
