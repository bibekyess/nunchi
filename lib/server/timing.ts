import 'server-only';

export type Outcome = 'ok' | 'error' | 'aborted';

export type Field = string | number | undefined;

/** Returns a function that reports the whole milliseconds elapsed since the call. */
export function startTimer(): () => number {
  const t0 = performance.now();
  return () => Math.round(performance.now() - t0);
}

/** Formats a duration for a log field; undefined stays undefined so the field is skipped. */
export const ms = (n: number | undefined): Field => (n === undefined ? undefined : `${n}ms`);

/**
 * Logs one line per request with durations and sizes, e.g.
 * `[translate] ok open=120ms ttft=380ms total=1902ms out=214ch`.
 * Only pass numbers and short labels here, never transcript or prompt text.
 */
export function logTiming(route: string, outcome: Outcome, fields: Record<string, Field>): void {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${value}`);
  const line = [`[${route}]`, outcome, ...parts].join(' ');
  if (outcome === 'error') console.warn(line);
  else console.info(line);
}
