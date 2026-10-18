import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  createLogger,
  createRequestLog,
  requestIdFrom,
  withRequestLog,
  type Level,
} from '@/lib/server/log';

const LEVELS: Level[] = ['debug', 'info', 'warn', 'error'];
let spies: Record<Level, MockInstance<(...data: unknown[]) => void>>;

/** Every line logged so far, with its console level. */
const lines = () =>
  LEVELS.flatMap((level) => spies[level].mock.calls.map((c) => ({ level, line: String(c[0]) })));

beforeEach(() => {
  vi.stubEnv('LOG_FORMAT', 'pretty');
  vi.stubEnv('LOG_LEVEL', 'debug');
  spies = {
    debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    info: vi.spyOn(console, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('log format', () => {
  it('writes readable lines with units, the request id last', () => {
    const log = createRequestLog('translate', 'r1');
    log.done('ok', { openMs: 120, ttftMs: 380, dir: 'ko->en', outChars: 214, sizeKb: 48 });
    expect(lines()).toHaveLength(1);
    expect(lines()[0].level).toBe('info');
    expect(lines()[0].line).toMatch(
      /^\[translate\] ok open=120ms ttft=380ms dir=ko->en out=214ch size=48KB total=\d+ms rid=r1$/,
    );
  });

  it('writes JSON lines in production, and LOG_FORMAT overrides either way', () => {
    vi.stubEnv('LOG_FORMAT', '');
    vi.stubEnv('NODE_ENV', 'production');
    createRequestLog('translate', 'r1').done('ok', { openMs: 120 });
    const entry = JSON.parse(lines()[0].line);
    expect(entry).toMatchObject({ level: 'info', route: 'translate', rid: 'r1', msg: 'ok' });
    expect(entry.openMs).toBe(120);
    expect(typeof entry.totalMs).toBe('number');
    expect(Date.parse(entry.time)).not.toBeNaN();

    vi.stubEnv('LOG_FORMAT', 'pretty');
    createLogger({ scope: 'boot' }).info('hello');
    expect(lines()[1].line).toBe('[boot] hello');

    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('LOG_FORMAT', 'json');
    createLogger({ scope: 'boot' }).info('hello');
    expect(JSON.parse(lines()[2].line)).toMatchObject({ scope: 'boot', msg: 'hello' });
  });

  it('filters by LOG_LEVEL, defaulting to info outside development', () => {
    const log = createLogger({ scope: 't' });
    vi.stubEnv('LOG_LEVEL', 'warn');
    log.info('no');
    log.warn('yes');
    vi.stubEnv('LOG_LEVEL', '');
    vi.stubEnv('NODE_ENV', 'production');
    log.debug('no');
    log.info('yes');
    vi.stubEnv('NODE_ENV', 'development');
    log.debug('yes');
    expect(lines().map((l) => l.line)).toEqual(['[t] yes', '[t] yes', '[t] yes']);
  });

  it('logs an error outcome at warn and the others at info, once per request', () => {
    const failed = createRequestLog('summarize', 'a');
    failed.done('error');
    failed.done('ok');
    createRequestLog('transcribe', 'b').done('aborted');
    expect(
      lines().map(({ level, line }) => [level, line.split(' ').slice(0, 2).join(' ')]),
    ).toEqual([
      ['info', '[transcribe] aborted'],
      ['warn', '[summarize] error'],
    ]);
  });

  it('skips undefined and empty fields and drops secret-looking keys', () => {
    createLogger({ scope: 't' }).info('x', {
      a: undefined,
      b: '',
      c: 0,
      authorization: 'Bearer abc',
      accessToken: 'abc',
      LLM_API_KEY: 'abc',
      clientSecret: 'abc',
      password: 'abc',
    });
    expect(lines()[0].line).toBe('[t] x c=0');
  });

  it('quotes values with spaces and puts multi-line values below the line', () => {
    createLogger({ scope: 't' }).error('boom', { detail: 'gpu oom', stack: 'Error: x\n  at y' });
    expect(lines()[0].line).toBe('[t] boom detail="gpu oom"\nError: x\n  at y');
  });
});

describe('requestIdFrom', () => {
  const from = (id?: string) =>
    requestIdFrom(
      new Request('http://app.test/', { headers: id === undefined ? {} : { 'x-request-id': id } }),
    );

  it('keeps an id that looks like one', () => {
    expect(from('abc-123')).toBe('abc-123');
    expect(from('a.b_C-9')).toBe('a.b_C-9');
  });

  it('replaces a missing, empty, too long or odd one with a new UUID', () => {
    const uuid = /^[0-9a-f-]{36}$/;
    for (const id of [undefined, '', 'x'.repeat(129), 'a b', 'a\tb', 'a"b']) {
      expect(from(id)).toMatch(uuid);
    }
    // A newline can't even be set as a header value; the check covers it all the same.
    expect(
      requestIdFrom({ headers: new Map([['x-request-id', 'a\nb']]) } as unknown as Request),
    ).toMatch(uuid);
  });
});

describe('withRequestLog', () => {
  const request = (headers: Record<string, string> = {}) =>
    new Request('http://app.test/api/x', { headers });

  it('sends the request id back and logs a refused request at info', async () => {
    const handler = withRequestLog('x', async () => Response.json({}, { status: 401 }));
    const res = await handler(request({ 'x-request-id': 'abc-123' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('x-request-id')).toBe('abc-123');
    expect(lines()).toHaveLength(1);
    expect(lines()[0].level).toBe('info');
    expect(lines()[0].line).toMatch(/^\[x\] response status=401 total=\d+ms rid=abc-123$/);
  });

  it('logs a successful request at debug, and nothing more once it called done', async () => {
    const quiet = withRequestLog('x', async () => new Response('ok'));
    const res = await quiet(request());
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(lines().map((l) => l.level)).toEqual(['debug']);

    const done = withRequestLog('x', async (_req, log) => {
      log.done('ok');
      return new Response('ok', { status: 202 });
    });
    await done(request());
    expect(lines().map((l) => l.level)).toEqual(['debug', 'info']);
  });

  it('turns a thrown error into a JSON 500 with the request id', async () => {
    const handler = withRequestLog('x', async () => {
      throw new TypeError('kaput');
    });
    const res = await handler(request({ 'x-request-id': 'r9' }));
    expect(res.status).toBe(500);
    expect(res.headers.get('x-request-id')).toBe('r9');
    expect((await res.json()).error.code).toBe('internal_error');
    const error = lines().find((l) => l.level === 'error')!.line;
    expect(error).toContain('[x] unexpected error errName=TypeError errMessage=kaput rid=r9');
    expect(error).toContain('at '); // the stack
  });

  it('sets the header on a response whose headers are immutable', async () => {
    const handler = withRequestLog('x', async () => Response.redirect('http://app.test/', 302));
    const res = await handler(request({ 'x-request-id': 'r2' }));
    expect(res.status).toBe(302);
    expect(res.headers.get('x-request-id')).toBe('r2');
    expect(res.headers.get('location')).toBe('http://app.test/');
  });
});
