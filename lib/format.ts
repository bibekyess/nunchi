/** 75_000 → "01:15"; an hour or more → "1:02:03". */
export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Short local date and time, e.g. "Oct 13, 14:05". */
export function formatDateTime(ms: number, locale?: string): string {
  return new Date(ms).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export type DateGroup = 'today' | 'week' | 'earlier';

export const DATE_GROUP_LABELS: Record<DateGroup, string> = {
  today: 'Today',
  week: 'This week',
  earlier: 'Earlier',
};

/**
 * Splits items (newest first) into Today / This week (the six days before today) / Earlier,
 * by local calendar day. Empty groups are left out; order within a group is kept.
 */
export function groupByDate<T>(
  items: readonly T[],
  timeOf: (item: T) => number,
  now = Date.now(),
): { group: DateGroup; items: T[] }[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  // setDate handles month ends and DST shifts, unlike subtracting 6 * 24 h.
  const weekStart = new Date(startOfToday);
  weekStart.setDate(weekStart.getDate() - 6);
  const week = weekStart.getTime();

  const groups: Record<DateGroup, T[]> = { today: [], week: [], earlier: [] };
  for (const item of items) {
    const t = timeOf(item);
    groups[t >= today ? 'today' : t >= week ? 'week' : 'earlier'].push(item);
  }
  return (['today', 'week', 'earlier'] as const)
    .filter((g) => groups[g].length > 0)
    .map((g) => ({ group: g, items: groups[g] }));
}
