'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSessionStore } from '@/lib/store/session-store';
import { HealthDot } from '../HealthDot';

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function ElapsedTimer() {
  const since = useSessionStore((s) => s.listeningSince);
  const before = useSessionStore((s) => s.listenedMs);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  const elapsed = before + (since !== null ? Math.max(0, now - since) : 0);
  return <span className="text-sm text-muted tabular-nums">{formatElapsed(elapsed)}</span>;
}

export function SessionHeader() {
  const title = useSessionStore((s) => s.session?.title ?? '');
  const setTitle = useSessionStore((s) => s.setTitle);

  return (
    <header className="flex items-center gap-2 border-b border-line px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <Link
        href="/"
        aria-label="Home"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-subtle"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden />
      </Link>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Session title"
        className="min-h-11 min-w-0 flex-1 rounded-lg bg-transparent px-2 text-lg font-semibold focus:bg-subtle focus:outline-none"
      />
      <ElapsedTimer />
      <span className="px-2">
        <HealthDot compact />
      </span>
    </header>
  );
}
