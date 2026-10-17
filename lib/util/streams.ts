// Guards for streamed responses. Environment-agnostic: used by the browser engines, the
// server routes and (later) on-device workers.

export interface IdleTimeoutOptions {
  /** Time allowed for the first piece (prompt processing can be slow); defaults to `ms`. */
  firstMs?: number;
  /** Stops waiting as soon as this aborts, with an AbortError. */
  signal?: AbortSignal;
  /** Called when the limit passes, before the error is thrown; stop the upstream here. */
  onTimeout?: () => void;
  /** The error to throw when the limit passes (callers build a retryable timeout). */
  error: () => Error;
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

/** The next item of `it`, or a rejection once `ms` pass or `signal` aborts. */
function nextWithin<T>(
  it: AsyncIterator<T>,
  ms: number,
  { signal, onTimeout, error }: IdleTimeoutOptions,
): Promise<IteratorResult<T>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const timer = setTimeout(() => {
      cleanup();
      onTimeout?.();
      reject(error());
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(abortError(signal!));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    // A late result after a timeout or abort lands on a settled promise and is ignored.
    it.next().then(
      (result) => {
        cleanup();
        resolve(result);
      },
      (err: unknown) => {
        cleanup();
        reject(err);
      },
    );
  });
}

/**
 * Passes `source` through, but throws `error()` when the next piece takes longer than `ms`
 * (`firstMs` for the first one). A stream that stalls (half-open connection, stuck server)
 * then fails instead of waiting forever. Timers are cleared after every piece.
 */
export async function* withIdleTimeout<T>(
  source: AsyncIterable<T>,
  ms: number,
  options: IdleTimeoutOptions,
): AsyncGenerator<T> {
  const it = source[Symbol.asyncIterator]();
  let done = false;
  let first = true;
  try {
    for (;;) {
      const result = await nextWithin(it, first ? (options.firstMs ?? ms) : ms, options);
      first = false;
      if (result.done) {
        done = true;
        return;
      }
      yield result.value;
    }
  } finally {
    // Stopped early (timeout, abort, the consumer left): let the source clean up. Not awaited,
    // since a source stuck mid-read only finishes once its request is aborted.
    if (!done) void it.return?.()?.catch(() => {});
  }
}
