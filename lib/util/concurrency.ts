/**
 * Runs tasks with at most `size` in flight; waiting tasks start in the order they arrived. A
 * finished task hands its slot straight to the next waiter, so a newcomer arriving in between
 * can't take it and run alongside (over the limit, ahead of the queue).
 */
export class Semaphore {
  private waiting: (() => void)[] = [];
  private active = 0;
  constructor(private readonly size: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.size) this.active++;
    else await new Promise<void>((r) => this.waiting.push(r)); // the slot arrives already counted
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

/** Maps `items` with at most `limit` calls in flight, starting them in order. Keeps the order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
