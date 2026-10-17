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

// Review finding F: a call that arrives just as a slot frees must not jump ahead of a waiter
// (and run alongside it, over the limit).
describe('Semaphore under contention', () => {
  it('hands a freed slot to the next waiter, never exceeding the limit', async () => {
    // The newcomer arrives 0..6 microtask turns after the slot frees, to hit the gap.
    for (let turns = 0; turns <= 6; turns++) {
      const sem = new Semaphore(1);
      let active = 0;
      let peak = 0;
      const order: string[] = [];
      const work = (name: string) => async () => {
        order.push(name);
        peak = Math.max(peak, ++active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      };
      let releaseA!: () => void;
      const a = sem.run(() => new Promise<void>((r) => (releaseA = r)));
      const b = sem.run(work('waiter'));
      releaseA();
      let later = Promise.resolve();
      for (let i = 0; i < turns; i++) later = later.then(() => {});
      const c = later.then(() => sem.run(work('newcomer')));
      await Promise.all([a, b, c]);
      expect({ turns, peak }).toEqual({ turns, peak: 1 });
      expect(order).toEqual(['waiter', 'newcomer']);
    }
  });

  it('frees the slot when a task throws', async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    let ran = false;
    await sem.run(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
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
