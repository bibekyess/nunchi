import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '@/lib/server/env';
import { resetLlmClient } from '@/lib/server/llm';
import { LLM, SPEACHES, TEST_ENV } from './helpers';

// connection() needs a Next.js request scope; outside one it is irrelevant.
vi.mock('next/server', () => ({ connection: async () => {} }));
const { GET } = await import('@/app/api/health/route');

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

const models = () => HttpResponse.json({ object: 'list', data: [{ id: 'm', object: 'model' }] });

describe('GET /api/health', () => {
  it('reports both upstreams', async () => {
    server.use(http.get(`${SPEACHES}/models`, models), http.get(`${LLM}/models`, models));
    const res = await GET(new Request('http://app.test/api/health'));
    expect(await res.json()).toEqual({ speaches: 'ok', llm: 'ok' });
  });

  it('marks a failing upstream as error', async () => {
    server.use(
      http.get(`${SPEACHES}/models`, models),
      http.get(`${LLM}/models`, () => new HttpResponse(null, { status: 503 })),
    );
    const res = await GET(new Request('http://app.test/api/health'));
    expect(await res.json()).toEqual({ speaches: 'ok', llm: 'error' });
  });
});
