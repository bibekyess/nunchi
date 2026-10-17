import { describe, expect, it } from 'vitest';
import { mapLimit, Semaphore } from '@/lib/util/concurrency';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('Semaphore', () => {
  it('runs at most `size` tasks at once, in arrival order', async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        sem.run(async () => {
          started.push(i);
          peak = Math.max(peak, ++active);
          await tick();
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('mapLimit', () => {
  it('keeps the input order whatever order calls finish in', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([30, 0, 10, 0], 2, async (delay, i) => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, delay));
      active--;
      return `r${i}`;
    });
    expect(out).toEqual(['r0', 'r1', 'r2', 'r3']);
    expect(peak).toBe(2);
  });

  it('rejects when a call fails', async () => {
    await expect(
      mapLimit([1, 2], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});
