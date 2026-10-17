import { useEffect, useState } from 'react';
import type { EndpointSettings, EngineChoice } from '@/lib/settings/engines';
import { buildEngines } from './registry';
import { ENGINE_TASKS, type EngineStatus, type EngineTask } from './types';

export type EngineStatuses = Record<EngineTask, EngineStatus | null>;

const UNKNOWN: EngineStatuses = { speech: null, translate: null, summary: null };

/** How often statuses are checked again while something shows them. */
export const STATUS_REFRESH_MS = 60_000;

/**
 * Status of the engines for `choice` (custom ones as configured in `endpoints`), checked now,
 * every minute and whenever either changes. null while a check is pending. Server engines
 * share one /api/health request between them.
 */
export function useEngineStatuses(
  choice: EngineChoice,
  endpoints: EndpointSettings,
): EngineStatuses {
  const [statuses, setStatuses] = useState<EngineStatuses>(UNKNOWN);
  const { speech, translate, summary } = choice;
  // Compared by value: a new object with the same settings must not start another check.
  const endpointsKey = JSON.stringify(endpoints);

  useEffect(() => {
    const abort = new AbortController();
    const engines = buildEngines(
      { speech, translate, summary },
      JSON.parse(endpointsKey) as EndpointSettings,
    );
    const check = async () => {
      const results = await Promise.all(
        ENGINE_TASKS.map((task) =>
          engines[task]
            .status(abort.signal)
            .catch((): EngineStatus => ({ state: 'error', reason: 'Status check failed.' })),
        ),
      );
      if (abort.signal.aborted) return;
      setStatuses(
        Object.fromEntries(ENGINE_TASKS.map((task, i) => [task, results[i]])) as EngineStatuses,
      );
    };
    void check();
    const timer = setInterval(check, STATUS_REFRESH_MS);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [speech, translate, summary, endpointsKey]);

  return statuses;
}
