'use client';

import { ENGINE_LABELS } from '@/lib/engines/registry';
import { ENGINE_TASKS, isLocked, type EngineStatus, type EngineTask } from '@/lib/engines/types';
import { useEngineStatuses } from '@/lib/engines/use-engine-status';
import { useEndpointSettings, useEngineChoice } from '@/lib/settings/use-engine-settings';
import { describeStatus } from './EngineStatusBadge';
import { UNLOCK_INPUT_ID } from './home/UnlockCard';
import { Badge, cx, type Tone } from './ui';

const TASK_NAMES: Record<EngineTask, string> = {
  speech: 'Speech',
  translate: 'Translation',
  summary: 'Summary',
};

/** A word or two per task for the label, e.g. "Translation down · Summary down". */
function word(status: EngineStatus): string {
  switch (status.state) {
    case 'ready':
      return 'ok';
    case 'not_configured':
      return 'not set up';
    case 'unavailable':
      return status.reason.replace(/\.$/, '').toLowerCase();
    case 'error':
      return status.needsPasscode ? 'server locked' : 'down';
  }
}

const LOCKED_HINT =
  "The app's servers need a passcode. Enter it on the home page or in Processing settings, " +
  'or switch to your own servers there.';

/** Health of the engines chosen for each task (the app's servers by default). */
export function HealthDot({ compact = false }: { compact?: boolean }) {
  const choice = useEngineChoice();
  const statuses = useEngineStatuses(choice, useEndpointSettings());
  const allServer = ENGINE_TASKS.every((t) => choice[t] === 'server');

  const known = ENGINE_TASKS.every((t) => statuses[t] !== null);
  const list = ENGINE_TASKS.map((t) => statuses[t]).filter((s): s is EngineStatus => s !== null);
  const notReady = list.filter((s) => s.state !== 'ready');
  // Every problem is the missing passcode: one calm label instead of one per task.
  const onlyLocked = known && notReady.length > 0 && notReady.every(isLocked);
  const tone: Tone = !known
    ? 'neutral'
    : list.some((s) => s.state === 'error' && !isLocked(s))
      ? 'danger'
      : list.every((s) => s.state === 'ready')
        ? 'ok'
        : 'warn';

  const label = !known
    ? allServer
      ? 'Checking servers…'
      : 'Checking…'
    : onlyLocked
      ? 'Server locked'
      : tone === 'ok'
        ? allServer
          ? 'Servers ready'
          : 'Ready'
        : // Only the tasks that need attention, so the label stays short on phones.
          ENGINE_TASKS.filter((t) => statuses[t]!.state !== 'ready')
            .map((t) => `${TASK_NAMES[t]} ${word(statuses[t]!)}`)
            .join(' · ');
  // Tooltip: which engine does each task and how it is.
  const detail = ENGINE_TASKS.map(
    (t) => `${TASK_NAMES[t]} (${ENGINE_LABELS[choice[t]]}): ${describeStatus(statuses[t]).text}`,
  )
    .concat(list.some(isLocked) ? ['', LOCKED_HINT] : [])
    .join('\n');

  if (!compact) {
    const badge = (
      <Badge
        tone={tone}
        dot
        pulse={!known}
        role="status"
        title={detail}
        size="md"
        className="min-w-0"
      >
        <span className="truncate">{label}</span>
      </Badge>
    );
    if (!list.some(isLocked)) return badge;
    // Locked: the badge leads to the passcode field on the home page.
    return (
      <button
        type="button"
        onClick={() => document.getElementById(UNLOCK_INPUT_ID)?.focus()}
        className="flex min-w-0 rounded-full focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none"
      >
        {badge}
      </button>
    );
  }

  // Compact (session header): a dot with a soft halo; the label is for screen readers.
  return (
    <span className="inline-flex items-center" role="status" title={detail}>
      <span
        aria-hidden
        className={cx(
          'h-2 w-2 rounded-full ring-[3px] transition-colors duration-300',
          tone === 'neutral' && 'animate-pulse-dot bg-ink-faint ring-ink-faint/20',
          tone === 'danger' && 'bg-danger ring-danger/20 shadow-[0_0_8px_var(--danger)]',
          tone === 'warn' && 'bg-warn ring-warn/20 shadow-[0_0_8px_var(--warn)]',
          tone === 'ok' && 'bg-ok ring-ok/20 shadow-[0_0_8px_var(--ok)]',
        )}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
