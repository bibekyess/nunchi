import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCESS_TOKEN_HEADER } from '@/lib/errors';
import {
  accessTokenVersion,
  ApiError,
  getAccessToken,
  resetServerHealth,
  serverSpeech,
  serverSummary,
  serverTranslate,
  setAccessToken,
  unlockServer,
} from '@/lib/engines/server';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => resetServerHealth());
afterEach(() => vi.unstubAllGlobals());

describe('server engines', () => {
  it('maps /api/health per task with one request for all three', async () => {
    const fetch = vi.fn(async () => json({ speaches: 'ok', llm: 'error' }));
    vi.stubGlobal('fetch', fetch);
    const [speech, translate, summary] = await Promise.all([
      serverSpeech.status(),
      serverTranslate.status(),
      serverSummary.status(),
    ]);
    expect(speech).toEqual({ state: 'ready' });
    expect(translate.state).toBe('error');
    expect(summary.state).toBe('error');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a task the server has no upstream for', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ speaches: 'not_configured', llm: 'ok' })),
    );
    expect(await serverSpeech.status()).toEqual({ state: 'not_configured' });
    expect(await serverTranslate.status()).toEqual({ state: 'ready' });
  });

  it('reports a missing passcode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { code: 'unauthorized', message: 'no' } }, 401)),
    );
    expect(await serverSpeech.status()).toEqual({
      state: 'error',
      reason: 'Passcode required.',
      needsPasscode: true,
    });
  });

  it('does not reuse a failed check', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(json({ speaches: 'ok', llm: 'ok' }));
    vi.stubGlobal('fetch', fetch);
    expect((await serverSpeech.status()).state).toBe('error');
    expect(await serverSpeech.status()).toEqual({ state: 'ready' });
  });

  it('rejects a transcription answer this version does not understand', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ transcript: 'from a newer server' })),
    );
    const err = await serverSpeech
      .transcribe(new Float32Array(16), { language: 'auto' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'bad_response', retryable: false });
  });

  it('accepts a transcription without a language, as JSON drops it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ text: '', durationMs: 900, segments: [] })),
    );
    const result = await serverSpeech.transcribe(new Float32Array(16), { language: 'auto' });
    expect(result).toEqual({ text: '', durationMs: 900, segments: [] });
  });

  it('needs the network', () => {
    expect([serverSpeech, serverTranslate, serverSummary].every((e) => e.needsNetwork)).toBe(true);
  });
});

describe('unlockServer', () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    });
  });

  it('keeps the token for an accepted passcode, never the passcode itself', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { code: 'unauthorized', message: 'no' } }, 401))
      .mockResolvedValueOnce(json({ token: '123.sig', expiresAt: 123 }))
      .mockResolvedValueOnce(json({ speaches: 'ok', llm: 'ok' }));
    vi.stubGlobal('fetch', fetch);
    expect((await serverSpeech.status()).state).toBe('error');

    const version = accessTokenVersion();
    expect(await unlockServer('secret')).toBe('ok');
    expect(getAccessToken()).toBe('123.sig');
    expect(accessTokenVersion()).toBe(version + 1);
    const [url, init] = fetch.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/unlock');
    expect(JSON.parse(init.body as string)).toEqual({ passcode: 'secret' });
    // The locked result is not reused after unlocking, and the token is what gets sent.
    expect(await serverSpeech.status()).toEqual({ state: 'ready' });
    const next = fetch.mock.calls[2][1] as RequestInit;
    expect((next.headers as Record<string, string>)[ACCESS_TOKEN_HEADER]).toBe('123.sig');
  });

  it('reports a wrong passcode and keeps the old one', async () => {
    setAccessToken('old');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { code: 'unauthorized', message: 'no' } }, 401)),
    );
    expect(await unlockServer('wrong')).toBe('wrong');
    expect(getAccessToken()).toBe('old');
  });

  it('reports an unreachable server without keeping the passcode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await unlockServer('secret')).toBe('unreachable');
    expect(getAccessToken()).toBeNull();
  });
});
