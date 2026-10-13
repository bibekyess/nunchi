'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadSession } from '@/lib/db/dexie';
import { persistSession, recoverUtterance } from '@/lib/db/persist';
import { SessionController } from '@/lib/session-controller';
import { sessionStore, useSessionStore } from '@/lib/store/session-store';

const ControllerContext = createContext<SessionController | null>(null);

/** Loads the saved session if there is one, otherwise starts a new one. */
async function openSession(sessionId: string) {
  const store = useSessionStore.getState();
  try {
    const saved = await loadSession(sessionId);
    if (saved) {
      store.hydrateSession(saved.session, saved.utterances.map(recoverUtterance));
      return;
    }
  } catch (err) {
    // Private mode or blocked storage: the session still works, it just isn't saved.
    console.error('[db] load failed', err);
  }
  store.startSession(sessionId);
}

export function SessionControllerProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: ReactNode;
}) {
  const [controller, setController] = useState<SessionController | null>(null);

  useEffect(() => {
    let cancelled = false;
    let c: SessionController | null = null;
    let stopPersisting: (() => Promise<void>) | null = null;
    // The controller owns the mic and timers, so it must live and die with this effect
    // (Strict Mode mounts twice); rendering waits for it. It's created after loading, so the
    // queue continues numbering after the saved utterances.
    void openSession(sessionId).then(() => {
      if (cancelled) return;
      stopPersisting = persistSession(sessionStore);
      c = new SessionController();
      setController(c);
    });
    return () => {
      cancelled = true;
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
