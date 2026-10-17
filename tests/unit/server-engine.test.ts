import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetServerHealth,
  serverSpeech,
  serverSummary,
  serverTranslate,
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

  it('needs the network', () => {
    expect([serverSpeech, serverTranslate, serverSummary].every((e) => e.needsNetwork)).toBe(true);
  });
});
