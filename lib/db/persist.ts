import type { StoreApi } from 'zustand';
import { elapsedMs, type SessionState } from '@/lib/store/session-store';
import type { Session, Utterance, UtteranceStatus } from '@/lib/types';
import { saveSession } from './dexie';

/** Writes while a translation streams are batched this long. */
export const STREAM_DEBOUNCE_MS = 1000;
/** A failed write is tried again after this long, doubling up to the max while it keeps failing. */
export const SAVE_RETRY_MS = 2000;
export const SAVE_RETRY_MAX_MS = 30_000;

const SETTLED: ReadonlySet<UtteranceStatus> = new Set(['done', 'skipped', 'error']);

/**
 * A reloaded session has no audio and no running requests, so anything still in flight
 * becomes an error. Translations can be retried from the saved source text; transcriptions can't.
 */
export function recoverUtterance(u: Utterance): Utterance {
  if (u.status === 'transcribing') {
    return { ...u, status: 'error', error: 'Interrupted before transcription' };
  }
  if (u.status === 'translating') {
    return { ...u, status: 'error', error: 'Interrupted while translating' };
  }
  return u;
}

export interface PersistOptions {
  save?: (session: Session, utterances: Utterance[]) => Promise<void>;
  now?: () => number;
}

/**
 * Mirrors the active session into IndexedDB. Settled utterances (done / skipped / error) are
 * written right away; streaming updates are debounced. A session is first written when it gets
 * its first utterance, so opening and leaving an empty session leaves nothing behind.
 * Returns a function that writes anything pending and stops.
 */
export function persistSession(
  store: StoreApi<SessionState>,
  { save = saveSession, now = Date.now }: PersistOptions = {},
): () => Promise<void> {
  const sessionId = store.getState().session?.id;
  const dirty = new Set<string>();
  let sessionDirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  let stopped = false;
  let retryMs = SAVE_RETRY_MS;

  const flush = (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    const state = store.getState();
    if (!state.session || state.session.id !== sessionId || state.ids.length === 0) {
      return chain;
    }
    if (!sessionDirty && dirty.size === 0) return chain;
    const session: Session = { ...state.session, durationMs: elapsedMs(state, now()) };
    const utterances = [...dirty].map((id) => state.byId[id]).filter(Boolean);
    dirty.clear();
    sessionDirty = false;
    // Serialize writes so an older snapshot never lands after a newer one.
    chain = chain
      .then(() => save(session, utterances))
      .then(
        () => {
          retryMs = SAVE_RETRY_MS;
        },
        (err) => {
          console.error('[db] save failed', err);
          // Settled utterances never change again, so unless they are marked again they would
          // never be written. The next write reads them from the store, so it saves the latest.
          for (const u of utterances) dirty.add(u.id);
          sessionDirty = true;
          if (!stopped && !timer) {
            timer = setTimeout(flush, retryMs);
            retryMs = Math.min(retryMs * 2, SAVE_RETRY_MAX_MS);
          }
        },
      );
    return chain;
  };

  const schedule = (urgent: boolean) => {
    if (urgent) {
      if (timer) clearTimeout(timer);
      // Batch everything from the current tick.
      timer = setTimeout(flush, 0);
    } else if (!timer) {
      timer = setTimeout(flush, STREAM_DEBOUNCE_MS);
    }
  };

  const unsubscribe = store.subscribe((state, prev) => {
    if (stopped || state.session?.id !== sessionId) return;
    let urgent = false;
    if (state.byId !== prev.byId) {
      for (const id of state.ids) {
        const u = state.byId[id];
        if (u === prev.byId[id]) continue;
        dirty.add(id);
        if (SETTLED.has(u.status) || !prev.byId[id]) urgent = true;
      }
    }
    if (state.session !== prev.session) {
      sessionDirty = true;
      urgent = true;
    }
    if (state.recorder !== prev.recorder) {
      // Pause / stop: keep the saved duration in step.
      sessionDirty = true;
      urgent = true;
    }
    if (dirty.size || sessionDirty) schedule(urgent);
  });

  const onPageHide = () => void flush();
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide);

  return () => {
    stopped = true;
    unsubscribe();
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide);
    return flush();
  };
}
