// Review finding A: a stream that stops sending, or a request that never answers, must fail
// with a retryable timeout instead of holding a queue slot forever.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAICompatible } from '@/lib/core/openai-compatible';
import { serverSpeech, serverTranslate } from '@/lib/engines/server';
import { EngineError } from '@/lib/errors';
import { streamText } from '@/lib/server/http';

const encoder = new TextEncoder();

const delta = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;

/** A body that sends `first` and then nothing, ever. Records whether it was cancelled. */
function stalledBody(first: string) {
  const state = { cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (first) controller.enqueue(encoder.encode(first));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

/** Tracks whether a promise has settled, without awaiting it. */
function track<T>(promise: Promise<T>) {
  const out: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  promise.then(
    (value) => Object.assign(out, { settled: true, value }),
    (error) => Object.assign(out, { settled: true, error }),
  );
  return out;
}

/** A fetch that never answers, but rejects with the signal's reason once aborted. */
function hangingFetch() {
  return vi.fn(
    (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('OpenAI-compatible streams', () => {
  it('give up when the stream stops mid-answer, and stop the request', async () => {
    let signal: AbortSignal | undefined;
    const { stream: sse } = stalledBody(delta('Hel'));
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const client = createOpenAICompatible({
      baseUrl: 'http://llm.test/v1',
      model: 'm',
      fetch,
      streamIdleMs: 50,
    });
    const stream = await client.chat.stream([{ role: 'user', content: 'hi' }], {
      temperature: 0,
      maxTokens: 5,
    });
    const got: string[] = [];
    let error: unknown;
    try {
      for await (const piece of stream) got.push(piece);
    } catch (err) {
      error = err;
    }
    expect(got).toEqual(['Hel']);
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).kind).toBe('timeout');
    expect((error as EngineError).retryable).toBe(true);
    expect(signal?.aborted).toBe(true);
  }, 2000);

  it('allow the first piece the whole call timeout, then the idle limit', async () => {
    const { stream: sse } = stalledBody('');
    const fetch = vi.fn(
      async () => new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } }),
    );
    const client = createOpenAICompatible({
      baseUrl: 'http://llm.test/v1',
      model: 'm',
      fetch,
      streamIdleMs: 10,
    });
    const stream = await client.chat.stream([{ role: 'user', content: 'hi' }], {
      temperature: 0,
      maxTokens: 5,
      timeoutMs: 120,
    });
    const t0 = performance.now();
    const err = await (async () => {
      for await (const piece of stream) void piece;
    })().catch((e: unknown) => e);
    expect((err as EngineError).kind).toBe('timeout');
    // Waited for the first piece longer than the 10 ms idle limit.
    expect(performance.now() - t0).toBeGreaterThanOrEqual(100);
  }, 2000);
});

describe('server engine', () => {
  it('gives up on a translation stream that stops, and cancels it', async () => {
    vi.useFakeTimers();
    const { stream: body, state } = stalledBody('Hello');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body)),
    );
    const deltas: string[] = [];
    const result = track(
      serverTranslate.translate(
        { text: '안녕', sourceLang: 'ko', targetLang: 'en', context: [], glossary: [] },
        (d) => deltas.push(d),
      ),
    );
    await vi.advanceTimersByTimeAsync(200_000);
    expect(deltas).toEqual(['Hello']);
    expect(result.settled).toBe(true);
    expect(result.error).toBeInstanceOf(EngineError);
    expect((result.error as EngineError).kind).toBe('timeout');
    expect((result.error as EngineError).retryable).toBe(true);
    expect(state.cancelled).toBe(true);
  });

  it('gives up on a request that never answers', async () => {
    vi.useFakeTimers();
    const fetch = hangingFetch();
    vi.stubGlobal('fetch', fetch);
    const result = track(serverSpeech.transcribe(new Float32Array(1600), { language: 'auto' }));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(result.settled).toBe(true);
    expect((result.error as EngineError).kind).toBe('timeout');
    expect((result.error as EngineError).retryable).toBe(true);
  });

  it('still treats a cancel by the caller as a cancel', async () => {
    const fetch = hangingFetch();
    vi.stubGlobal('fetch', fetch);
    const abort = new AbortController();
    const pending = serverSpeech.transcribe(new Float32Array(1600), {
      language: 'auto',
      signal: abort.signal,
    });
    abort.abort();
    const err = await pending.catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
    expect(err).not.toBeInstanceOf(EngineError);
  });
});

describe('streamText (server)', () => {
  it('ends a response whose text stops coming, and stops the upstream', async () => {
    const abort = vi.fn();
    async function* stalled() {
      yield 'Hello';
      await new Promise(() => {});
    }
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = streamText({
      route: 'translate',
      text: stalled(),
      abort,
      signal: new AbortController().signal,
      elapsed: () => 0,
      fields: ({ ttft, total }) => ({ ttft, total }),
      idleMs: 50,
    });
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('Hello');
    const err = await reader.read().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(abort).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toContain('[translate] error');
    expect(error.mock.calls.flat().join(' ')).toContain('upstream_timeout');
    info.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  }, 2000);
});
