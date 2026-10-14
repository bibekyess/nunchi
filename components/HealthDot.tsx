'use client';

import { useEffect, useState } from 'react';
import { fetchHealth, type HealthStatus } from '@/lib/api-client';
import { Badge, cx } from './ui';

type Health = HealthStatus | { failed: true } | null;

const REFRESH_MS = 60_000;

export function HealthDot({ compact = false }: { compact?: boolean }) {
  const [health, setHealth] = useState<Health>(null);

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      fetchHealth()
        .catch(() => ({ failed: true as const }))
        .then((h) => !cancelled && setHealth(h));
    void check();
    const timer = setInterval(check, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const down =
    health !== null && ('failed' in health || health.speaches !== 'ok' || health.llm !== 'ok');
  const label =
    health === null
      ? 'Checking servers…'
      : 'failed' in health
        ? 'Server check failed'
        : !down
          ? 'Servers ready'
          : `Speech ${health.speaches === 'ok' ? 'ok' : 'down'} · Translation ${health.llm === 'ok' ? 'ok' : 'down'}`;

  const checking = health === null;

  if (!compact) {
    return (
      <Badge
        tone={checking ? 'neutral' : down ? 'danger' : 'ok'}
        dot
        pulse={checking}
        role="status"
        title={label}
        size="md"
      >
        {label}
      </Badge>
    );
  }

  // Compact (session header): a dot with a soft halo; the label is for screen readers.
  return (
    <span className="inline-flex items-center" role="status" title={label}>
      <span
        aria-hidden
        className={cx(
          'h-2 w-2 rounded-full ring-[3px] transition-colors duration-300',
          checking
            ? 'animate-pulse-dot bg-ink-faint ring-ink-faint/20'
            : down
              ? 'bg-danger ring-danger/20 shadow-[0_0_8px_var(--danger)]'
              : 'bg-ok ring-ok/20 shadow-[0_0_8px_var(--ok)]',
        )}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
