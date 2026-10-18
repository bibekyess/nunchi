import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/translate/route';
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
  text: '번역 잘 되고 있나요?',
  sourceLang: 'ko',
  targetLang: 'en',
  context: [{ source: '안녕하세요.', translation: 'Hello.' }],
  glossary: [{ term: '지민', translation: 'Jimin' }],
};

function request(payload: unknown) {
  return new Request('http://app.test/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

describe('POST /api/translate', () => {
  it('streams the translation with the think block removed', async () => {
    let upstream: Record<string, unknown> | undefined;
    let header: string | null = null;
    server.use(
      http.post(`${LLM}/chat/completions`, async ({ request }) => {
        upstream = (await request.json()) as Record<string, unknown>;
        header = request.headers.get('x-gpu-key');
        return chatStream([
          '<thi',
          'nk>\n\n</think>',
          '\n\nIs the ',
          'translation ',
          'working well?',
        ]);
      }),
    );

    const res = await POST(request(body));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe('Is the translation working well?');

    expect(header).toBe('secret-value');
    expect(upstream).toMatchObject({
      model: 'qwen-test',
      stream: true,
      temperature: 0.2,
      max_tokens: 400,
      chat_template_kwargs: { enable_thinking: false },
    });
    const messages = upstream?.messages as { role: string; content: string }[];
    expect(messages[0].content).toContain('지민 → Jimin');
    expect(messages[1].content).toContain('- 안녕하세요. => Hello.');
  });

  it('retries once without streaming when the stream is empty', async () => {
    const calls: Record<string, unknown>[] = [];
    server.use(
      http.post(`${LLM}/chat/completions`, async ({ request }) => {
        const json = (await request.json()) as Record<string, unknown>;
        calls.push(json);
        return json.stream ? chatStream(['<think>', '</think>', '\n']) : chatJson('Is it working?');
      }),
    );
    const res = await POST(request(body));
    expect(await res.text()).toBe('Is it working?');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ temperature: 0 });
    expect(calls[1].stream).toBeFalsy();
  });

  it('uses temperature 0 for a client retry', async () => {
    let temperature: unknown;
    server.use(
      http.post(`${LLM}/chat/completions`, async ({ request }) => {
        temperature = ((await request.json()) as Record<string, unknown>).temperature;
        return chatStream(['Yes.']);
      }),
    );
    await (await POST(request({ ...body, retry: true }))).text();
    expect(temperature).toBe(0);
  });

  it('returns a JSON 502 when the LLM rejects the request', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    server.use(
      http.post(`${LLM}/chat/completions`, () =>
        HttpResponse.json({ error: { message: 'bad header secret-value' } }, { status: 401 }),
      ),
    );
    const res = await POST(request(body));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain('upstream_error');
    expect(text).not.toContain('secret-value');
    spy.mockRestore();
  });

  it('calls the LLM once on a 5xx (the browser queue owns retries) and logs the body only', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    let auth: string | null = null;
    server.use(
      http.post(`${LLM}/chat/completions`, ({ request }) => {
        calls++;
        auth = request.headers.get('authorization');
        return HttpResponse.json({ error: { message: 'gpu oom' } }, { status: 503 });
      }),
    );
    const res = await POST(request(body));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('gpu oom');
    expect(calls).toBe(1);
    // LLM_API_KEY is empty in the test env: the "none" placeholder is still sent.
    expect(auth).toBe('Bearer none');
    expect(spy.mock.calls.flat().join(' ')).toContain('gpu oom');
    spy.mockRestore();
  });

  it('keeps the LLM credentials out of the JSON logs when an upstream echoes them', async () => {
    vi.stubEnv('LOG_FORMAT', 'json');
    const spies = (['debug', 'info', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    server.use(
      http.post(`${LLM}/chat/completions`, () =>
        HttpResponse.json({ error: { message: 'bad header secret-value' } }, { status: 401 }),
      ),
    );
    const res = await POST(request(body));
    expect(res.status).toBe(502);

    const lines = spies.flatMap((spy) => spy.mock.calls.map((c) => String(c[0])));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(JSON.parse(line)).toMatchObject({
        route: 'translate',
        rid: res.headers.get('x-request-id'),
        level: expect.any(String),
      });
      expect(line).not.toContain('secret-value');
    }
    expect(lines.join('\n')).toContain('bad header [redacted]');
    for (const spy of spies) spy.mockRestore();
  });

  it('validates the body', async () => {
    expect((await POST(request({ ...body, text: '   ' }))).status).toBe(400);
    expect((await POST(request({ ...body, targetLang: 'ja' }))).status).toBe(400);
    expect((await POST(request({ ...body, context: Array(6).fill(body.context[0]) }))).status).toBe(
      400,
    );
    const notJson = new Request('http://app.test/api/translate', { method: 'POST', body: 'hi' });
    expect((await POST(notJson)).status).toBe(400);
  });
});
