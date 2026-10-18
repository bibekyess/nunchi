import { describe, expect, it } from 'vitest';
import { formatElapsed, groupByDate } from '@/lib/display/format';

describe('formatElapsed', () => {
  it('pads minutes and seconds, adds hours when needed', () => {
    expect(formatElapsed(75_000)).toBe('01:15');
    expect(formatElapsed(3_723_000)).toBe('1:02:03');
  });
});

describe('groupByDate', () => {
  // Local time, so the test holds in any time zone.
  const now = new Date(2026, 9, 13, 15, 0).getTime(); // Tue Oct 13, 15:00
  const at = (month: number, day: number, hour = 12) => new Date(2026, month, day, hour).getTime();
  const group = (times: number[]) =>
    groupByDate(times, (t) => t, now).map((g) => [g.group, g.items.length]);

  it('splits into today, the six days before, and earlier', () => {
    const times = [
      at(9, 13, 9),
      at(9, 13, 0),
      at(9, 12, 23),
      at(9, 7, 0), // six days ago, start of day
      at(9, 6, 23), // seven days ago
      at(8, 1),
    ];
    expect(group(times)).toEqual([
      ['today', 2],
      ['week', 2],
      ['earlier', 2],
    ]);
  });

  it('counts midnight as today', () => {
    expect(group([new Date(2026, 9, 13, 0, 0, 0, 0).getTime()])).toEqual([['today', 1]]);
    expect(group([new Date(2026, 9, 12, 23, 59, 59, 999).getTime()])).toEqual([['week', 1]]);
  });

  it('drops empty groups and keeps order', () => {
    const items = [{ t: at(8, 2) }, { t: at(8, 1) }];
    const result = groupByDate(items, (i) => i.t, now);
    expect(result).toHaveLength(1);
    expect(result[0].group).toBe('earlier');
    expect(result[0].items).toEqual(items);
  });

  it('handles an empty list', () => {
    expect(groupByDate([], (t: number) => t, now)).toEqual([]);
  });
});
