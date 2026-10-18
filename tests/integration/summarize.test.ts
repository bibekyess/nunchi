import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/summarize/route';
import { resetEnvCache } from '@/lib/server/env';
import { resetLlmClient } from '@/lib/server/llm';
import { chatJson, chatStream, LLM, TEST_ENV } from './helpers';

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

const body = {
  utterances: [
    { seq: 1, sourceText: '지민이 발표합니다.', translation: 'Jimin is presenting.' },
    { seq: 0, sourceText: '안녕하세요.', translation: 'Hello.' },
  ],
  glossary: [{ term: '지민', translation: 'Jimin' }],
  outputLang: 'en',
};

function request(payload: unknown) {
  return new Request('http://app.test/api/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

type ChatBody = { messages: { content: string }[]; stream?: boolean; max_tokens: number };

describe('POST /api/summarize', () => {
  it('streams a summary of the transcript in seq order, without the think block', async () => {
    let upstream: ChatBody | undefined;
    server.use(
      http.post(`${LLM}/chat/completions`, async ({ request }) => {
        upstream = (await request.json()) as ChatBody;
        return chatStream(['<think>\n</think>\n\n', '## Overview\n', 'Jimin presents.']);
      }),
    );
    const res = await POST(request(body));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('## Overview\nJimin presents.');
    expect(upstream?.stream).toBe(true);
    expect(upstream?.messages[1].content).toContain(
      '[0] 안녕하세요. => Hello.\n[1] 지민이 발표합니다. => Jimin is presenting.',
    );
  });

  it('summarizes a long transcript in parts, then merges them', async () => {
    const calls: ChatBody[] = [];
    server.use(
      http.post(`${LLM}/chat/completions`, async ({ request }) => {
        const b = (await request.json()) as ChatBody;
        calls.push(b);
        if (!b.stream) return chatJson(`partial ${calls.length}`);
        return chatStream(['merged']);
      }),
    );
    const long = Array.from({ length: 30 }, (_, seq) => ({
      seq,
      sourceText: '가'.repeat(1000),
      translation: 'a'.repeat(1000),
    }));
    const res = await POST(request({ ...body, utterances: long }));
    expect(await res.text()).toBe('merged');
    const parts = calls.filter((c) => !c.stream);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].messages[0].content).toContain(`part 1 of ${parts.length}`);
    const merge = calls.find((c) => c.stream)!;
    expect(merge.messages[1].content).toContain('### Part 1\npartial');
  });

  it('rejects an empty transcript', async () => {
    const res = await POST(request({ ...body, utterances: [] }));
    expect(res.status).toBe(400);
    const blank = await POST(request({ ...body, utterances: [{ seq: 0, sourceText: ' ' }] }));
    expect(blank.status).toBe(400);
  });

  it('hides upstream error bodies', async () => {
    server.use(
      http.post(`${LLM}/chat/completions`, () =>
        HttpResponse.json({ error: 'secret-value leaked' }, { status: 500 }),
      ),
    );
    const res = await POST(request(body));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('secret-value');
  });
});
