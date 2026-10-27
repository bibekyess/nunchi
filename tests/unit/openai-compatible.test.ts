import { describe, expect, it, vi } from 'vitest';
import { encodeWav } from '@/lib/audio/wav';
import {
  createOpenAICompatible,
  EndpointError,
  parseSse,
  parseTranscription,
} from '@/lib/core/openai-compatible';
import { EngineError } from '@/lib/errors';

const encoder = new TextEncoder();

/** A body that delivers `chunks` one read at a time. */
function body(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

const delta = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;

describe('parseSse', () => {
  it('reassembles events split across chunks, several per chunk', async () => {
    const stream = 'data: one\n\ndata: two\n\ndata: three\n\n';
    const chunks = [
      stream.slice(0, 3),
      stream.slice(3, 14),
      stream.slice(14, 15),
      stream.slice(15),
    ];
    expect(await collect(parseSse(body(chunks)))).toEqual(['one', 'two', 'three']);
  });

  it('handles CRLF and CR line endings, including a CRLF split across chunks', async () => {
    expect(await collect(parseSse(body(['data: a\r', '\n\r\ndata: b\r\r'])))).toEqual(['a', 'b']);
  });

  it('skips comments and keep-alives and ignores other fields', async () => {
    const chunks = [': ping\n\n', 'event: message\nid: 1\ndata: x\n\n', ':keepalive\n\n'];
    expect(await collect(parseSse(body(chunks)))).toEqual(['x']);
  });

  it('joins multi-line data and stops at [DONE]', async () => {
    const chunks = ['data: a\ndata: b\n\n', 'data: [DONE]\n\n', 'data: after\n\n'];
    expect(await collect(parseSse(body(chunks)))).toEqual(['a\nb']);
  });

  it('emits a last event that has no blank line after it', async () => {
    expect(await collect(parseSse(body(['data: last'])))).toEqual(['last']);
  });
});

describe('parseTranscription', () => {
  it('maps verbose_json', () => {
    expect(
      parseTranscription({
        text: ' 안녕 ',
        language: 'korean',
        duration: 1.25,
        segments: [{ text: ' 안녕', no_speech_prob: 0.1, avg_logprob: -0.3 }],
      }),
    ).toEqual({
      text: '안녕',
      language: 'ko',
      durationMs: 1250,
      segments: [{ text: '안녕', noSpeechProb: 0.1, avgLogprob: -0.3 }],
    });
  });

  it('maps word timings when the server sends them', () => {
    expect(
      parseTranscription({ text: 'hi there', words: [{ word: ' hi', start: 0, end: 0.4 }] }).words,
    ).toEqual([{ word: ' hi', start: 0, end: 0.4 }]);
  });

  it('accepts plain json with only text', () => {
    expect(parseTranscription({ text: 'hi' })).toEqual({
      text: 'hi',
      language: undefined,
      durationMs: 0,
      segments: [],
    });
  });
});

type FetchArgs = [string, RequestInit];

function client(handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const calls: FetchArgs[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push([String(url), init ?? {}]);
    return handler(String(url), init ?? {});
  });
  const c = createOpenAICompatible({
    baseUrl: 'http://localhost:11434/v1/',
    model: 'qwen3:4b',
    apiKey: 'sk-test',
    headers: { 'x-gw': 'g' },
    extraBody: { chat_template_kwargs: { enable_thinking: false } },
    engine: 'endpoint',
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { c, calls };
}

const msgs = [{ role: 'user' as const, content: 'hi' }];

describe('createOpenAICompatible: chat', () => {
  it('streams content deltas with the model, auth, headers and extra body', async () => {
    const { c, calls } = client(
      () =>
        new Response(body([delta('Hel'), delta('lo'), ': ping\n\n', 'data: [DONE]\n\n']), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    );
    const stream = await c.chat.stream(msgs, { temperature: 0.2, maxTokens: 10 });
    expect(await collect(stream)).toEqual(['Hel', 'lo']);

    const [url, init] = calls[0];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
    expect(headers['x-gw']).toBe('g');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'qwen3:4b',
      messages: msgs,
      temperature: 0.2,
      max_tokens: 10,
      stream: true,
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it('turns an error event mid-stream into an upstream error', async () => {
    const { c } = client(
      () => new Response(body([delta('a'), `data: {"error":{"message":"oom"}}\n\n`])),
    );
    const stream = await c.chat.stream(msgs, { temperature: 0, maxTokens: 5 });
    const seen: string[] = [];
    const err = await (async () => {
      for await (const d of stream) seen.push(d);
    })().catch((e: unknown) => e);
    expect(seen).toEqual(['a']);
    expect(err).toBeInstanceOf(EndpointError);
    expect((err as EndpointError).kind).toBe('upstream');
    expect((err as EndpointError).detail).toContain('oom');
  });

  it('returns the content of a non-streamed completion', async () => {
    const { c, calls } = client(() =>
      Response.json({ choices: [{ message: { role: 'assistant', content: 'OK' } }] }),
    );
    expect(await c.chat.complete(msgs, { temperature: 0, maxTokens: 1 })).toBe('OK');
    expect(JSON.parse(calls[0][1].body as string).stream).toBeUndefined();
  });

  it.each([
    [401, 'auth', false],
    [403, 'auth', false],
    [404, 'bad_request', false],
    [429, 'upstream', true],
    [500, 'upstream', true],
    [504, 'timeout', true],
  ])(
    'maps HTTP %i to %s (retryable %s), keeping the body as detail only',
    async (status, kind, retryable) => {
      const { c } = client(() => new Response('secret-key echoed', { status }));
      const err = (await c.chat
        .complete(msgs, { temperature: 0, maxTokens: 1 })
        .catch((e: unknown) => e)) as EndpointError;
      expect(err).toBeInstanceOf(EngineError);
      expect(err.kind).toBe(kind);
      expect(err.retryable).toBe(retryable);
      expect(err.status).toBe(status);
      expect(err.engine).toBe('endpoint');
      expect(err.message).not.toContain('secret');
      expect(err.detail).toBe('secret-key echoed');
    },
  );

  it('reports a fetch TypeError (no status: CORS, refused, DNS) as a network error', async () => {
    const { c } = client(() => {
      throw new TypeError('Failed to fetch');
    });
    const err = (await c.chat
      .complete(msgs, { temperature: 0, maxTokens: 1 })
      .catch((e: unknown) => e)) as EndpointError;
    expect(err.kind).toBe('network');
    expect(err.status).toBeUndefined();
    expect(err.retryable).toBe(true);
    expect(err.message).toContain('localhost:11434');
    expect(err.message).toContain('CORS');
  });

  it('times out while waiting for the response to start', async () => {
    vi.useFakeTimers();
    try {
      const { c } = client(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            ),
          ),
      );
      const pending = c.chat
        .complete(msgs, { temperature: 0, maxTokens: 1, timeoutMs: 1000 })
        .catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1000);
      const err = (await pending) as EndpointError;
      expect(err.kind).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rethrows an AbortError when the caller cancels', async () => {
    const { c } = client(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          ),
        ),
    );
    const ac = new AbortController();
    const pending = c.chat
      .complete(msgs, { temperature: 0, maxTokens: 1, signal: ac.signal })
      .catch((e: unknown) => e);
    ac.abort();
    expect(((await pending) as Error).name).toBe('AbortError');
  });

  it('stopping early cancels the download', async () => {
    let cancelled = false;
    const { c } = client(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(delta('first')));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    );
    const stream = await c.chat.stream(msgs, { temperature: 0, maxTokens: 5 });
    for await (const d of stream) {
      expect(d).toBe('first');
      break; // the consumer stops early
    }
    stream.abort();
    expect(cancelled).toBe(true);
  });
});

describe('createOpenAICompatible: speech and models', () => {
  // Review finding D: the speech model takes 16 kHz samples and encodes the WAV itself, so
  // on-device engines can share transcribeWithFallback without a WAV round trip.
  it('posts the samples as a 16 kHz mono WAV, with model, language, prompt and verbose_json', async () => {
    const { c, calls } = client(() =>
      Response.json({ text: ' hello ', language: 'en', duration: 1 }),
    );
    const samples = new Float32Array(160).fill(0.25);
    const result = await c.speech.transcribe(samples, {
      language: 'en',
      prompt: 'Jimin.',
    });
    expect(result).toEqual({ text: 'hello', language: 'en', durationMs: 1000, segments: [] });
    const [url, init] = calls[0];
    expect(url).toBe('http://localhost:11434/v1/audio/transcriptions');
    const form = init.body as FormData;
    expect(form.get('model')).toBe('qwen3:4b');
    expect(form.get('language')).toBe('en');
    expect(form.get('prompt')).toBe('Jimin.');
    expect(form.get('response_format')).toBe('verbose_json');
    const file = form.get('file') as Blob;
    expect(file).toBeInstanceOf(Blob);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(
      new Uint8Array(await encodeWav(samples).arrayBuffer()),
    );
  });

  it('lists model ids', async () => {
    const { c, calls } = client(() =>
      Response.json({ object: 'list', data: [{ id: 'a' }, { id: 'b' }, { nope: 1 }] }),
    );
    expect(await c.listModels()).toEqual(['a', 'b']);
    expect(calls[0][0]).toBe('http://localhost:11434/v1/models');
  });

  it('says so when /models is not an OpenAI-style model list', async () => {
    const { c } = client(() => Response.json({ hello: 'world' }));
    const err = (await c.listModels().catch((e: unknown) => e)) as EndpointError;
    expect(err.kind).toBe('bad_request');
    expect(err.message).toContain('/v1');
  });

  it('says so when the response is not JSON (e.g. a web page)', async () => {
    const { c } = client(() => new Response('<html></html>', { status: 200 }));
    const err = (await c.listModels().catch((e: unknown) => e)) as EndpointError;
    expect(err.kind).toBe('upstream');
    expect(err.message).toContain("isn't JSON");
  });
});
