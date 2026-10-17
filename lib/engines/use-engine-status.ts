import { useEffect, useState } from 'react';
import type { EngineChoice } from '@/lib/settings/engines';
import { buildEngines } from './registry';
import { ENGINE_TASKS, type EngineStatus, type EngineTask } from './types';

export type EngineStatuses = Record<EngineTask, EngineStatus | null>;

const UNKNOWN: EngineStatuses = { speech: null, translate: null, summary: null };

/** How often statuses are checked again while something shows them. */
export const STATUS_REFRESH_MS = 60_000;

/**
 * Status of the engines for `choice`, checked now and every minute. null while a check is
 * pending. Server engines share one /api/health request between them.
 */
export function useEngineStatuses(choice: EngineChoice): EngineStatuses {
  const [statuses, setStatuses] = useState<EngineStatuses>(UNKNOWN);
  const { speech, translate, summary } = choice;

  useEffect(() => {
    const abort = new AbortController();
    const engines = buildEngines({ speech, translate, summary });
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
  }, [speech, translate, summary]);

  return statuses;
}
