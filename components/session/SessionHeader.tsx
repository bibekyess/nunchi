'use client';

import { ChevronLeft, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatElapsed } from '@/lib/format';
import { elapsedMs, useSessionStore } from '@/lib/store/session-store';
import { HealthDot } from '../HealthDot';
import { Badge } from '../ui';
import { SessionMenu } from './SessionMenu';

/** Ticks once a second on its own, so the rest of the header doesn't re-render. */
function ElapsedTimer() {
  const since = useSessionStore((s) => s.listeningSince);
  const before = useSessionStore((s) => s.listenedMs);
  const recorder = useSessionStore((s) => s.recorder);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  const time = formatElapsed(elapsedMs({ listenedMs: before, listeningSince: since }, now));

  if (recorder === 'listening') {
    return (
      <Badge tone="danger" dot pulse>
        <span className="font-semibold tracking-wide">REC</span>
        {time}
      </Badge>
    );
  }
  if (recorder === 'paused') {
    return (
      <Badge tone="warn" dot>
        {time}
      </Badge>
    );
  }
  return <Badge>{time}</Badge>;
}

export function SessionHeader() {
  const title = useSessionStore((s) => s.session?.title ?? '');
  const setTitle = useSessionStore((s) => s.setTitle);

  return (
    <header className="flex min-h-14 items-center gap-1.5 py-1.5">
      <Link
        href="/"
        aria-label="Home"
        title="Home"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors duration-150 ease-out hover:bg-ink/[0.06] active:bg-ink/[0.09]"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden />
      </Link>
      {/* Reads as editable: a soft fill on hover, a pencil hint, and a ring while typing. */}
      <label className="group relative flex min-w-0 flex-1 items-center">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Session title"
          className="min-h-11 w-full min-w-0 truncate rounded-xl bg-transparent pr-8 pl-2.5 text-[1.0625rem] font-semibold tracking-tight text-ink transition-[background-color,box-shadow] duration-150 ease-out outline-none hover:bg-ink/[0.05] focus:bg-surface focus:shadow-sm focus:ring-2 focus:ring-ring/40"
        />
        <Pencil
          className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-ink-faint opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
          aria-hidden
        />
      </label>
      <ElapsedTimer />
      <span className="flex h-11 w-6 items-center justify-center">
        <HealthDot compact />
      </span>
      <SessionMenu />
    </header>
  );
}
