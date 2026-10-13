'use client';

import { useEffect, useState } from 'react';

type Status = 'ok' | 'error';
type Health = { speaches: Status; llm: Status } | { failed: true } | null;

export function HealthDot() {
  const [health, setHealth] = useState<Health>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { failed: true }))
      .catch(() => ({ failed: true }))
      .then((h) => !cancelled && setHealth(h));
    return () => {
      cancelled = true;
    };
  }, []);

  const label =
    health === null
      ? 'Checking servers…'
      : 'failed' in health
        ? 'Server check failed'
        : health.speaches === 'ok' && health.llm === 'ok'
          ? 'Servers ready'
          : `Speech ${health.speaches === 'ok' ? 'ok' : 'down'} · Translation ${health.llm === 'ok' ? 'ok' : 'down'}`;

  const color =
    health === null
      ? 'bg-gray-400'
      : 'failed' in health || health.speaches !== 'ok' || health.llm !== 'ok'
        ? 'bg-red-500'
        : 'bg-green-500';

  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted" role="status">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} aria-hidden />
      {label}
    </span>
  );
}
