'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { openSession } from '@/lib/db/open-session';
import { persistSession } from '@/lib/db/persist';
import { SessionController } from '@/lib/session/controller';
import { sessionStore, useSessionStore, type RecorderState } from '@/lib/session/store';

const ControllerContext = createContext<SessionController | null>(null);

export function SessionControllerProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: ReactNode;
}) {
  const [controller, setController] = useState<SessionController | null>(null);

  useEffect(() => {
    const cancelled = new AbortController();
    let c: SessionController | null = null;
    let stopPersisting: (() => Promise<void>) | null = null;
    // The controller owns the mic and timers, so it must live and die with this effect
    // (Strict Mode mounts twice); rendering waits for it. It's created after loading, so the
    // queue continues numbering after the saved utterances.
    void openSession(sessionStore, sessionId, cancelled.signal).then((opened) => {
      if (!opened) return;
      if (opened.persist) stopPersisting = persistSession(sessionStore);
      c = new SessionController();
      setController(c);
    });
    return () => {
      cancelled.abort();
      c?.dispose();
      useSessionStore.getState().setRecorder('idle');
      void stopPersisting?.();
      setController(null);
    };
  }, [sessionId]);

  if (!controller) return null;
  return <ControllerContext.Provider value={controller}>{children}</ControllerContext.Provider>;
}

export function useController(): SessionController {
  const c = useContext(ControllerContext);
  if (!c) throw new Error('useController outside SessionControllerProvider');
  return c;
}

/** What a mic button does when not listening: start (or retry after an error), or resume. */
export function startOrResume(controller: SessionController, recorder: RecorderState): void {
  if (recorder === 'paused') void controller.resume();
  else if (recorder === 'idle' || recorder === 'error') void controller.start();
}
