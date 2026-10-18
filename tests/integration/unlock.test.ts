import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '@/lib/server/env';
import { resetLlmClient } from '@/lib/server/llm';
import { LLM, SPEACHES, TEST_ENV } from './helpers';

// connection() needs a Next.js request scope; outside one it is irrelevant.
vi.mock('next/server', () => ({ connection: async () => {} }));
const { POST: unlock } = await import('@/app/api/unlock/route');
const { GET: health } = await import('@/app/api/health/route');

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  vi.stubEnv('APP_ACCESS_TOKEN', 'letmein');
  resetEnvCache();
  resetLlmClient();
});

const models = () => HttpResponse.json({ object: 'list', data: [{ id: 'm', object: 'model' }] });

const unlockWith = (body: unknown) =>
  unlock(
    new Request('http://app.test/api/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

const healthWith = (token: string) =>
  health(new Request('http://app.test/api/health', { headers: { 'x-nunchi-token': token } }));

describe('POST /api/unlock', () => {
  it('trades the passcode for a token the other routes accept', async () => {
    server.use(http.get(`${SPEACHES}/models`, models), http.get(`${LLM}/models`, models));
    const res = await unlockWith({ passcode: 'letmein' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { token, expiresAt } = await res.json();
    expect(token).not.toContain('letmein');
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect((await healthWith(token)).status).toBe(200);
  });

  it('rejects a wrong passcode', async () => {
    const res = await unlockWith({ passcode: 'nope' });
    expect(res.status).toBe(401);
  });

  it('rejects a body without a passcode', async () => {
    expect((await unlockWith({})).status).toBe(400);
  });

  it('stops accepting old tokens once the passcode changes', async () => {
    const { token } = await (await unlockWith({ passcode: 'letmein' })).json();
    vi.stubEnv('APP_ACCESS_TOKEN', 'changed');
    resetEnvCache();
    expect((await healthWith(token)).status).toBe(401);
  });

  it('returns an empty token when the server has no passcode', async () => {
    vi.stubEnv('APP_ACCESS_TOKEN', '');
    resetEnvCache();
    const res = await unlockWith({ passcode: 'anything' });
    expect(await res.json()).toEqual({ token: '', expiresAt: 0 });
  });
});
