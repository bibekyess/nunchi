'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { SessionController } from '@/lib/session-controller';
import { useSessionStore } from '@/lib/store/session-store';

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
    useSessionStore.getState().startSession(sessionId);
    // The controller owns the mic and timers, so it must live and die with this effect
    // (Strict Mode mounts twice); rendering waits for it.
    const c = new SessionController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setController(c);
    return () => {
      c.dispose();
      useSessionStore.getState().setRecorder('idle');
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
