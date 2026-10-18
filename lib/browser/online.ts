const abortError = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');

/**
 * Resolves once the browser is online (at once if it already is, or outside a browser).
 * Rejects with an AbortError when `signal` aborts; either way its listeners are removed.
 */
export function waitForOnline(signal?: AbortSignal): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener('online', onOnline);
      signal?.removeEventListener('abort', onAbort);
    };
    const onOnline = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(abortError(signal!));
    };
    window.addEventListener('online', onOnline);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
