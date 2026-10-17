'use client';

import { ENGINE_LABELS } from '@/lib/engines/registry';
import { ENGINE_TASKS, type EngineStatus, type EngineTask } from '@/lib/engines/types';
import { useEngineStatuses } from '@/lib/engines/use-engine-status';
import { useEngineChoice } from '@/lib/settings/engines';
import { describeStatus } from './EngineStatusBadge';
import { Badge, cx, type Tone } from './ui';

const TASK_NAMES: Record<EngineTask, string> = {
  speech: 'Speech',
  translate: 'Translation',
  summary: 'Summary',
};

/** One word per task for the summary label, e.g. "Speech ok · Translation down". */
function word(status: EngineStatus): string {
  switch (status.state) {
    case 'ready':
      return 'ok';
    case 'not_configured':
      return 'not set up';
    case 'unavailable':
      return status.reason.replace(/\.$/, '').toLowerCase();
    case 'error':
      return status.needsPasscode ? 'needs passcode' : 'down';
  }
}

/** Health of the engines chosen for each task (the app's servers by default). */
export function HealthDot({ compact = false }: { compact?: boolean }) {
  const choice = useEngineChoice();
  const statuses = useEngineStatuses(choice);
  const allServer = ENGINE_TASKS.every((t) => choice[t] === 'server');

  const known = ENGINE_TASKS.every((t) => statuses[t] !== null);
  const list = ENGINE_TASKS.map((t) => statuses[t]).filter((s): s is EngineStatus => s !== null);
  const tone: Tone = !known
    ? 'neutral'
    : list.some((s) => s.state === 'error')
      ? 'danger'
      : list.every((s) => s.state === 'ready')
        ? 'ok'
        : 'warn';

  const label = !known
    ? allServer
      ? 'Checking servers…'
      : 'Checking…'
    : tone === 'ok'
      ? allServer
        ? 'Servers ready'
        : 'Ready'
      : ENGINE_TASKS.map((t) => `${TASK_NAMES[t]} ${word(statuses[t]!)}`).join(' · ');
  // Tooltip: which engine does each task and how it is.
  const detail = ENGINE_TASKS.map(
    (t) => `${TASK_NAMES[t]} (${ENGINE_LABELS[choice[t]]}): ${describeStatus(statuses[t]).text}`,
  ).join('\n');

  if (!compact) {
    return (
      <Badge tone={tone} dot pulse={!known} role="status" title={detail} size="md">
        {label}
      </Badge>
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
