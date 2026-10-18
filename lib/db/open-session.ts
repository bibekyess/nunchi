import type { StoreApi } from 'zustand';
import type { SessionState } from '@/lib/session/store';
import { loadSession } from './dexie';
import { recoverUtterance } from './persist';

/**
 * Loads the saved session if there is one, otherwise starts a new one, and puts it in the store.
 * Nothing is written once `signal` aborts (the user moved on to another session meanwhile), so a
 * slow load can't replace the session that is open now; then it returns null.
 * Otherwise it returns whether the session may be saved: not when loading failed, since a saved
 * copy may exist and writing a fresh session over it would destroy it.
 */
export async function openSession(
  store: StoreApi<SessionState>,
  sessionId: string,
  signal: AbortSignal,
  load: typeof loadSession = loadSession,
): Promise<{ persist: boolean } | null> {
  let saved: Awaited<ReturnType<typeof loadSession>>;
  let persist = true;
  try {
    saved = await load(sessionId);
  } catch (err) {
    // Private mode or blocked storage: the session still works, it just isn't saved.
    console.error('[db] load failed', err);
    saved = null;
    persist = false;
  }
  if (signal.aborted) return null;
  const state = store.getState();
  if (saved) state.hydrateSession(saved.session, saved.utterances.map(recoverUtterance));
  else state.startSession(sessionId);
  if (!persist) state.setSaveProblem('unavailable');
  return { persist };
}
