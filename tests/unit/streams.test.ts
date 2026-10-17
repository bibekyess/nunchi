import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineError } from '@/lib/errors';
import { withIdleTimeout } from '@/lib/util/streams';

const timeout = () => new EngineError('timeout', 'stalled');

async function* from<T>(items: T[], gapMs = 0) {
  for (const item of items) {
    if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
    yield item;
  }
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

afterEach(() => vi.useRealTimers());

describe('withIdleTimeout', () => {
  it('passes pieces through and leaves no timers behind', async () => {
    vi.useFakeTimers();
    const run = collect(withIdleTimeout(from(['a', 'b', 'c'], 10), 50, { error: timeout }));
    await vi.advanceTimersByTimeAsync(100);
    expect(await run).toEqual(['a', 'b', 'c']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('throws the given error and calls onTimeout when a piece takes too long', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const run = collect(withIdleTimeout(from(['a', 'b'], 100), 50, { error: timeout, onTimeout }));
    const caught = run.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60);
    expect(await caught).toBeInstanceOf(EngineError);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('gives the first piece `firstMs`, then applies the idle limit', async () => {
    vi.useFakeTimers();
    async function* source() {
      await new Promise((r) => setTimeout(r, 150));
      yield 'first';
      await new Promise((r) => setTimeout(r, 80));
      yield 'second';
    }
    const got: string[] = [];
    const run = (async () => {
      for await (const x of withIdleTimeout(source(), 50, { firstMs: 200, error: timeout }))
        got.push(x);
    })().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(300);
    expect(got).toEqual(['first']);
    expect(await run).toBeInstanceOf(EngineError);
  });

  it('stops waiting as soon as the signal aborts', async () => {
    const abort = new AbortController();
    async function* never() {
      await new Promise(() => {});
      yield 'x';
    }
    const run = collect(withIdleTimeout(never(), 10_000, { signal: abort.signal, error: timeout }));
    abort.abort();
    const err = await run.catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
  });

  it('lets the source clean up when the consumer stops early', async () => {
    const cleaned = vi.fn();
    async function* source() {
      try {
        yield 1;
        yield 2;
      } finally {
        cleaned();
      }
    }
    for await (const x of withIdleTimeout(source(), 1000, { error: timeout })) {
      expect(x).toBe(1);
      break;
    }
    await Promise.resolve();
    expect(cleaned).toHaveBeenCalled();
  });
});
