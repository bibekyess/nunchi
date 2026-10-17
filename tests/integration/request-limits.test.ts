// Review finding E: oversized requests are refused before they are read into memory, and a
// summary can't fan out into hundreds of LLM calls.
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as summarize } from '@/app/api/summarize/route';
import { POST as transcribe } from '@/app/api/transcribe/route';
import { POST as translate } from '@/app/api/translate/route';
import { resetEnvCache } from '@/lib/server/env';
import { resetLlmClient } from '@/lib/server/llm';
import { LLM, SPEACHES, TEST_ENV } from './helpers';

const upstreamCalls = vi.fn();
const server = setupServer(
  http.all(`${LLM}/*`, () => {
    upstreamCalls();
    return new Response('unexpected', { status: 500 });
  }),
  http.all(`${SPEACHES}/*`, () => {
    upstreamCalls();
    return new Response('unexpected', { status: 500 });
  }),
);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(() => {
  upstreamCalls.mockClear();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  resetEnvCache();
  resetLlmClient();
});

/** A request whose body is never read unless the route reads it. */
function declared(url: string, bytes: number, contentType: string) {
  const read = vi.fn();
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        read();
        controller.close();
      },
    },
    { highWaterMark: 0 }, // pulled only when someone reads
  );
  const request = new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'Content-Length': String(bytes) },
    body,
    duplex: 'half',
  } as RequestInit);
  return { request, read };
}

/** A streamed body of `bytes` bytes with no Content-Length. */
function streamed(url: string, bytes: number, contentType: string) {
  const chunk = new Uint8Array(64 * 1024).fill(0x20);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= bytes) return controller.close();
      controller.enqueue(chunk);
      sent += chunk.byteLength;
    },
  });
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
    duplex: 'half',
  } as RequestInit);
}

describe('request size limits', () => {
  it('refuses a declared oversized body without reading it', async () => {
    const cases = [
      [translate, 'http://app.test/api/translate', 'application/json'],
      [summarize, 'http://app.test/api/summarize', 'application/json'],
      [transcribe, 'http://app.test/api/transcribe', 'multipart/form-data; boundary=x'],
    ] as const;
    for (const [route, url, type] of cases) {
      const { request, read } = declared(url, 50 * 1024 * 1024, type);
      const res = await route(request);
      expect(res.status, url).toBe(413);
      expect((await res.json()).error.code).toBe('payload_too_large');
      expect(read, url).not.toHaveBeenCalled();
    }
    expect(upstreamCalls).not.toHaveBeenCalled();
  });

  it('stops reading a streamed body once it passes the limit', async () => {
    const res = await translate(
      streamed('http://app.test/api/translate', 8 * 1024 * 1024, 'application/json'),
    );
    expect(res.status).toBe(413);
  });

  it('refuses a transcript too long to summarize', async () => {
    // 600 lines × 600 characters: within the per-line limits, far beyond a long meeting.
    const line = '가'.repeat(300);
    const utterances = Array.from({ length: 600 }, (_, seq) => ({
      seq,
      sourceText: line,
      translation: line,
    }));
    const res = await summarize(
      new Request('http://app.test/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ utterances, glossary: [], outputLang: 'en' }),
      }),
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error.message).toMatch(/too long to summarize/);
    expect(upstreamCalls).not.toHaveBeenCalled();
  });
});
