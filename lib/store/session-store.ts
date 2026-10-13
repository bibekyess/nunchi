import { create } from 'zustand';
import { MODE_PRESETS } from '@/lib/pipeline/direction';
import type { GlossaryEntry, Session, TranslationMode, Utterance } from '@/lib/types';

export type RecorderState = 'idle' | 'starting' | 'listening' | 'paused' | 'error';

export interface SessionState {
  session: Session | null;
  /** Utterance ids in speech order (by seq). Components select one utterance each by id. */
  ids: string[];
  byId: Record<string, Utterance>;

  recorder: RecorderState;
  recorderError: { kind: string; message: string } | null;
  /** Wall-clock ms when the current listening stretch began; drives the elapsed timer. */
  listeningSince: number | null;
  /** Elapsed listening ms before the current stretch. */
  listenedMs: number;
  micLevel: number;
  speaking: boolean;
  interrupted: boolean;
  /** The user stopped sharing the tab whose audio we were transcribing. */
  sharingStopped: boolean;
  needsAccessToken: boolean;

  // Session
  startSession: (id: string) => void;
  setTitle: (title: string) => void;
  setMode: (mode: TranslationMode) => void;
  setGlossary: (glossary: GlossaryEntry[], meetingContext?: string) => void;

  // Utterances. Every change goes through these two, so it can later be persisted (Phase 3)
  // and relayed to share viewers (Phase 5).
  addUtterance: (u: Utterance) => void;
  patchUtterance: (id: string, patch: Partial<Utterance>) => void;
  appendTranslation: (id: string, delta: string) => void;

  // Recorder
  setRecorder: (state: RecorderState, error?: { kind: string; message: string } | null) => void;
  setMicLevel: (level: number) => void;
  setSpeaking: (speaking: boolean) => void;
  setInterrupted: (interrupted: boolean) => void;
  setSharingStopped: (stopped: boolean) => void;
  setNeedsAccessToken: (needs: boolean) => void;
}

/** Remembered across sessions on this device: the last glossary pre-fills new sessions. */
const LAST_GLOSSARY_KEY = 'nunchi.lastGlossary';

function loadLastGlossary(): Pick<Session, 'glossary' | 'meetingContext'> {
  try {
    const raw = localStorage.getItem(LAST_GLOSSARY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Pick<Session, 'glossary' | 'meetingContext'>;
      if (Array.isArray(parsed.glossary)) return parsed;
    }
  } catch {
    // ignore
  }
  return { glossary: [] };
}

function saveLastGlossary(value: Pick<Session, 'glossary' | 'meetingContext'>) {
  try {
    localStorage.setItem(LAST_GLOSSARY_KEY, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function defaultTitle(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d} Meeting`;
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  session: null,
  ids: [],
  byId: {},
  recorder: 'idle',
  recorderError: null,
  listeningSince: null,
  listenedMs: 0,
  micLevel: 0,
  speaking: false,
  interrupted: false,
  sharingStopped: false,
  needsAccessToken: false,

  startSession: (id) => {
    if (get().session?.id === id) return;
    set({
      session: {
        id,
        title: defaultTitle(),
        createdAt: Date.now(),
        mode: MODE_PRESETS[0].mode,
        ...loadLastGlossary(),
      },
      ids: [],
      byId: {},
      recorder: 'idle',
      recorderError: null,
      listeningSince: null,
      listenedMs: 0,
      micLevel: 0,
      speaking: false,
      interrupted: false,
      sharingStopped: false,
    });
  },

  setTitle: (title) => set((s) => (s.session ? { session: { ...s.session, title } } : {})),
  setMode: (mode) => set((s) => (s.session ? { session: { ...s.session, mode } } : {})),
  setGlossary: (glossary, meetingContext) => {
    saveLastGlossary({ glossary, meetingContext });
    set((s) => (s.session ? { session: { ...s.session, glossary, meetingContext } } : {}));
  },

  addUtterance: (u) =>
    set((s) => {
      if (s.byId[u.id]) return {};
      const ids = [...s.ids];
      // Clips arrive in seq order, so this is almost always a push.
      let i = ids.length;
      while (i > 0 && s.byId[ids[i - 1]].seq > u.seq) i--;
      ids.splice(i, 0, u.id);
      return { ids, byId: { ...s.byId, [u.id]: u } };
    }),

  patchUtterance: (id, patch) =>
    set((s) => {
      const current = s.byId[id];
      if (!current) return {};
      return { byId: { ...s.byId, [id]: { ...current, ...patch } } };
    }),

  appendTranslation: (id, delta) =>
    set((s) => {
      const current = s.byId[id];
      if (!current) return {};
      return {
        byId: { ...s.byId, [id]: { ...current, translation: (current.translation ?? '') + delta } },
      };
    }),

  setRecorder: (recorder, error = null) =>
    set((s) => {
      const now = Date.now();
      const wasListening = s.recorder === 'listening' && s.listeningSince !== null;
      const listenedMs =
        wasListening && recorder !== 'listening'
          ? s.listenedMs + (now - s.listeningSince!)
          : s.listenedMs;
      const listeningSince =
        recorder === 'listening' ? (wasListening ? s.listeningSince : now) : null;
      return { recorder, recorderError: error, listenedMs, listeningSince };
    }),
  setMicLevel: (micLevel) => {
    // Avoid re-rendering the meter for imperceptible changes.
    if (Math.abs(get().micLevel - micLevel) > 0.02) set({ micLevel });
  },
  setSpeaking: (speaking) => set({ speaking }),
  setInterrupted: (interrupted) => set({ interrupted }),
  setSharingStopped: (sharingStopped) => set({ sharingStopped }),
  setNeedsAccessToken: (needsAccessToken) => set({ needsAccessToken }),
}));

/** Non-React access for the pipeline. */
export const sessionStore = useSessionStore;
