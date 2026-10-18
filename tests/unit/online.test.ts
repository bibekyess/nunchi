// Review finding G: waiting for the network can be cancelled, and leaves no listener behind.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForOnline } from '@/lib/browser/online';

function stubBrowser(onLine: boolean) {
  const listeners = new Map<string, Set<() => void>>();
  const win = {
    addEventListener: vi.fn((type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: () => void) => listeners.get(type)?.delete(fn)),
  };
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', { onLine });
  return {
    count: (type: string) => listeners.get(type)?.size ?? 0,
    fire: (type: string) => [...(listeners.get(type) ?? [])].forEach((fn) => fn()),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('waitForOnline', () => {
  it('resolves at once when online', async () => {
    stubBrowser(true);
    await expect(waitForOnline()).resolves.toBeUndefined();
  });

  it('resolves when the connection returns, and removes its listener', async () => {
    const browser = stubBrowser(false);
    const waiting = waitForOnline();
    expect(browser.count('online')).toBe(1);
    browser.fire('online');
    await expect(waiting).resolves.toBeUndefined();
    expect(browser.count('online')).toBe(0);
  });

  it('rejects with an AbortError when cancelled, and removes its listener', async () => {
    const browser = stubBrowser(false);
    const abort = new AbortController();
    const waiting = waitForOnline(abort.signal);
    abort.abort();
    const err = await Promise.race([
      waiting.catch((e: unknown) => e),
      new Promise((r) => setTimeout(() => r('still waiting'), 50)),
    ]);
    expect((err as Error).name).toBe('AbortError');
    expect(browser.count('online')).toBe(0);
  });

  it('rejects right away for a signal that already aborted', async () => {
    const browser = stubBrowser(false);
    const err = await waitForOnline(AbortSignal.abort()).catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
    expect(browser.count('online')).toBe(0);
  });
});
