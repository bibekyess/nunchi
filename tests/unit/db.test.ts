import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteSession,
  listSessions,
  loadSession,
  NunchiDB,
  renameSession,
  saveSession,
  setDb,
} from '@/lib/db/dexie';
import { openSession } from '@/lib/db/open-session';
import {
  persistSession,
  recoverUtterance,
  SAVE_RETRY_MS,
  STREAM_DEBOUNCE_MS,
} from '@/lib/db/persist';
import { sessionStore } from '@/lib/store/session-store';
import type { Session, Utterance } from '@/lib/types';

const session = (id: string, createdAt = 1): Session => ({
  id,
  title: `Meeting ${id}`,
  createdAt,
  mode: { source: 'auto', target: 'en' },
  glossary: [],
});

const utt = (sessionId: string, seq: number, over: Partial<Utterance> = {}): Utterance => ({
  id: `${sessionId}-${seq}`,
  sessionId,
  seq,
  startedAt: seq * 1000,
  durationMs: 900,
  status: 'done',
  sourceText: `원문 ${seq}`,
  translation: `line ${seq}`,
  ...over,
});

let n = 0;
beforeEach(() => {
  setDb(new NunchiDB(`test-${n++}`));
});

describe('dexie storage', () => {
  it('round-trips a session with its utterances in seq order', async () => {
    await saveSession(session('a'), [utt('a', 2), utt('a', 0), utt('a', 1)]);
    await saveSession(session('b'), [utt('b', 0)]);
    const loaded = await loadSession('a');
    expect(loaded?.session.title).toBe('Meeting a');
    expect(loaded?.utterances.map((u) => u.seq)).toEqual([0, 1, 2]);
    expect(await loadSession('missing')).toBeNull();
  });

  it('lists newest first with the first translated line', async () => {
    await saveSession(session('old', 1), [
      utt('old', 0, { status: 'skipped', translation: undefined }),
      utt('old', 1),
    ]);
    await saveSession(session('new', 2), []);
    const list = await listSessions();
    expect(list.map((s) => s.session.id)).toEqual(['new', 'old']);
    expect(list[1]).toMatchObject({ preview: 'line 1', utteranceCount: 1 });
    expect(list[0]).toMatchObject({ preview: undefined, utteranceCount: 0 });
  });

  it('renames and deletes', async () => {
    await saveSession(session('a'), [utt('a', 0)]);
    await renameSession('a', 'Standup');
    expect((await loadSession('a'))?.session.title).toBe('Standup');
    await deleteSession('a');
    expect(await loadSession('a')).toBeNull();
    expect(await listSessions()).toEqual([]);
  });
});

describe('recoverUtterance', () => {
  it('turns in-flight utterances into errors and leaves settled ones alone', () => {
    expect(recoverUtterance(utt('a', 0, { status: 'transcribing' })).status).toBe('error');
    expect(recoverUtterance(utt('a', 0, { status: 'translating' }))).toMatchObject({
      status: 'error',
      sourceText: '원문 0',
    });
    const done = utt('a', 0);
    expect(recoverUtterance(done)).toBe(done);
  });
});

describe('persistSession', () => {
  const state = () => sessionStore.getState();
  let stop: (() => Promise<void>) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStore.setState({ session: null });
    state().startSession('live');
  });

  afterEach(async () => {
    await stop?.();
    stop = null;
    vi.useRealTimers();
  });

  it('writes nothing until the first utterance', async () => {
    const save = vi.fn<(s: Session, u: Utterance[]) => Promise<void>>(async () => {});
    stop = persistSession(sessionStore, { save });
    state().setTitle('Renamed');
    await vi.runAllTimersAsync();
    expect(save).not.toHaveBeenCalled();

    state().addUtterance(utt('live', 0, { status: 'transcribing' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]).toMatchObject([{ id: 'live', title: 'Renamed' }, [{ seq: 0 }]]);
  });

  it('debounces streaming deltas and writes settled utterances at once', async () => {
    const save = vi.fn<(s: Session, u: Utterance[]) => Promise<void>>(async () => {});
    state().addUtterance(utt('live', 0, { status: 'translating', translation: '' }));
    stop = persistSession(sessionStore, { save });

    state().appendTranslation('live-0', 'Hel');
    state().appendTranslation('live-0', 'lo');
    await vi.advanceTimersByTimeAsync(STREAM_DEBOUNCE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);

    state().patchUtterance('live-0', { status: 'done', translation: 'Hello' });
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][1]).toMatchObject([{ status: 'done', translation: 'Hello' }]);
  });

  it('saves listening time, including the current stretch', async () => {
    const save = vi.fn<(s: Session, u: Utterance[]) => Promise<void>>(async () => {});
    const now = 10_000;
    state().addUtterance(utt('live', 0));
    stop = persistSession(sessionStore, { save, now: () => now });
    sessionStore.setState({ listenedMs: 5000, listeningSince: 8000 });
    state().setTitle('x');
    await vi.advanceTimersByTimeAsync(0);
    expect(save.mock.calls.at(-1)?.[0]).toMatchObject({ durationMs: 7000 });
  });

  it('writes again what a failed save left out', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = vi
      .fn<(s: Session, u: Utterance[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error('QuotaExceededError'))
      .mockResolvedValue(undefined);
    stop = persistSession(sessionStore, { save });
    state().addUtterance(utt('live', 0));
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);

    // The line is settled and won't change again: only the retry can save it.
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_MS);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][1]).toMatchObject([{ id: 'live-0', status: 'done' }]);
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(2);
    vi.mocked(console.error).mockRestore();
  });

  it('shows that saving fails until a save works again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = vi
      .fn<(s: Session, u: Utterance[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error('QuotaExceededError'))
      .mockResolvedValue(undefined);
    stop = persistSession(sessionStore, { save });
    state().addUtterance(utt('live', 0));
    await vi.advanceTimersByTimeAsync(0);
    expect(state().saveProblem).toBe('failing');

    await vi.advanceTimersByTimeAsync(SAVE_RETRY_MS);
    expect(state().saveProblem).toBeNull();
    vi.mocked(console.error).mockRestore();
  });

  it('end-to-end: a reloaded session matches what was recorded', async () => {
    vi.useRealTimers(); // fake-indexeddb needs real timers
    stop = persistSession(sessionStore);
    state().addUtterance(utt('live', 0, { status: 'transcribing' }));
    state().patchUtterance('live-0', { status: 'done' });
    state().addUtterance(utt('live', 1, { status: 'translating', translation: 'par' }));
    await stop();
    stop = null;
    const loaded = await loadSession('live');
    expect(loaded?.utterances.map((u) => u.status)).toEqual(['done', 'translating']);
    state().hydrateSession(loaded!.session, loaded!.utterances.map(recoverUtterance));
    expect(state().ids).toEqual(['live-0', 'live-1']);
    expect(state().byId['live-1'].status).toBe('error');
  });
});

describe('openSession', () => {
  const state = () => sessionStore.getState();
  const saved = (id: string) => ({ session: session(id), utterances: [utt(id, 0)] });

  beforeEach(() => sessionStore.setState({ session: null, ids: [], byId: {} }));

  it('loads a saved session, or starts a new one', async () => {
    expect(
      await openSession(sessionStore, 'a', new AbortController().signal, async () => saved('a')),
    ).toEqual({ persist: true });
    expect(state().session?.title).toBe('Meeting a');
    expect(state().ids).toEqual(['a-0']);
    expect(
      await openSession(sessionStore, 'b', new AbortController().signal, async () => null),
    ).toEqual({ persist: true });
    expect(state().session?.id).toBe('b');
    expect(state().ids).toEqual([]);
  });

  it('leaves the store alone when the user moved on before the load finished', async () => {
    let finishA!: () => void;
    const slowA = new Promise<void>((r) => (finishA = r));
    const first = new AbortController();
    const openingA = openSession(sessionStore, 'a', first.signal, async () => {
      await slowA;
      return saved('a');
    });
    first.abort(); // navigated to B
    await openSession(sessionStore, 'b', new AbortController().signal, async () => saved('b'));
    finishA();
    expect(await openingA).toBeNull();
    expect(state().session?.id).toBe('b');
    expect(state().ids).toEqual(['b-0']);
  });

  it("doesn't save over a session it failed to load", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const opened = await openSession(sessionStore, 'a', new AbortController().signal, async () => {
      throw new Error('blocked');
    });
    expect(opened).toEqual({ persist: false });
    expect(state().session?.id).toBe('a');
    expect(state().saveProblem).toBe('unavailable');
    vi.mocked(console.error).mockRestore();
  });
});
