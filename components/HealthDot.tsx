'use client';

import { useEffect, useState } from 'react';
import { fetchHealth, type HealthStatus } from '@/lib/api-client';
import { cx } from './ui';

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

  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted" role="status" title={label}>
      <span
        className={cx(
          'h-2.5 w-2.5 rounded-full',
          health === null ? 'bg-gray-400' : down ? 'bg-red-500' : 'bg-green-500',
        )}
        aria-hidden
      />
      <span className={compact ? 'sr-only' : undefined}>{label}</span>
    </span>
  );
}
