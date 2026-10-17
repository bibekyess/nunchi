import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as summarize } from '@/app/api/summarize/route';
import { POST as transcribe } from '@/app/api/transcribe/route';
import { POST as translate } from '@/app/api/translate/route';
import { resetEnvCache } from '@/lib/server/env';
import { resetLlmClient } from '@/lib/server/llm';
import { LLM, TEST_ENV, wavBlob } from './helpers';

// connection() needs a Next.js request scope; outside one it is irrelevant.
vi.mock('next/server', () => ({ connection: async () => {} }));
const { GET: health } = await import('@/app/api/health/route');

// Any request reaching an upstream fails the test: an unset service must not be called.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  resetEnvCache();
  resetLlmClient();
});

function unset(...keys: (keyof typeof TEST_ENV)[]) {
  for (const k of keys) vi.stubEnv(k, '');
  resetEnvCache();
  resetLlmClient();
}

const json = (url: string, payload: unknown) =>
  new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

const models = () => HttpResponse.json({ object: 'list', data: [] });

describe('a server without some upstreams', () => {
  it('answers 503 not_configured for speech when Speaches is not set', async () => {
    unset('SPEACHES_BASE_URL');
    const form = new FormData();
    form.append('audio', wavBlob());
    const res = await transcribe(
      new Request('http://app.test/api/transcribe', { method: 'POST', body: form }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: { code: 'not_configured', message: 'Speech-to-text is not set up on this server.' },
    });
  });

  it('answers 503 not_configured for translation and summary when the LLM is not set', async () => {
    unset('LLM_BASE_URL', 'LLM_MODEL', 'LLM_HEADER_NAME', 'LLM_HEADER_VALUE');
    const t = await translate(
      json('http://app.test/api/translate', {
        text: '네.',
        sourceLang: 'ko',
        targetLang: 'en',
      }),
    );
    expect(t.status).toBe(503);
    expect((await t.json()).error.code).toBe('not_configured');

    const s = await summarize(
      json('http://app.test/api/summarize', {
        utterances: [{ seq: 0, sourceText: '네.' }],
        outputLang: 'en',
      }),
    );
    expect(s.status).toBe(503);
    expect((await s.json()).error.code).toBe('not_configured');
  });

  it('reports not_configured in health without calling the upstream', async () => {
    unset('SPEACHES_BASE_URL');
    server.use(http.get(`${LLM}/models`, models));
    const res = await health(new Request('http://app.test/api/health'));
    expect(await res.json()).toEqual({ speaches: 'not_configured', llm: 'ok' });
  });

  it('still checks the passcode first', async () => {
    vi.stubEnv('APP_ACCESS_TOKEN', 'letmein');
    unset('SPEACHES_BASE_URL');
    const form = new FormData();
    form.append('audio', wavBlob());
    const res = await transcribe(
      new Request('http://app.test/api/transcribe', { method: 'POST', body: form }),
    );
    expect(res.status).toBe(401);
  });
});
