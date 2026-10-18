// Review finding L: summary generation, including a request superseded or cancelled while the
// engine is still working.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SummaryEngine } from '@/lib/engines/types';
import { EngineError } from '@/lib/errors';
import { sessionStore } from '@/lib/session/store';

const engine = vi.hoisted(() => ({ summarize: vi.fn() }));

vi.mock('@/lib/engines/registry', () => ({
  getEngine: () =>
    ({
      id: 'server',
      needsNetwork: true,
      status: async () => ({ state: 'ready' }),
      summarize: engine.summarize,
    }) satisfies SummaryEngine,
}));

const { generateSummary } = await import('@/lib/session/use-summary');

type Summarize = SummaryEngine['summarize'];

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const state = () => sessionStore.getState();

beforeEach(() => {
  engine.summarize.mockReset();
  sessionStore.setState({ session: null, needsAccessToken: false });
  state().startSession(`s${Math.random()}`);
  state().addUtterance({
    id: 'a',
    sessionId: state().session!.id,
    seq: 0,
    startedAt: 0,
    durationMs: 1000,
    status: 'done',
    sourceText: '안녕하세요.',
    translation: 'Hello.',
  });
});

describe('generateSummary', () => {
  it('streams the text, then saves it in the chosen language', async () => {
    engine.summarize.mockImplementation((async (request, onDelta) => {
      expect(request.utterances).toEqual([
        { seq: 0, sourceText: '안녕하세요.', translation: 'Hello.' },
      ]);
      expect(request.outputLang).toBe('ko');
      onDelta('## 개요');
      onDelta('\n인사.');
      return '## 개요\n인사.';
    }) as Summarize);
    const seen: string[] = [];
    const saved = await generateSummary('ko', new AbortController().signal, (t) => seen.push(t));
    expect(saved).toBe(true);
    expect(seen).toEqual(['## 개요', '## 개요\n인사.']);
    expect(state().session).toMatchObject({ summary: '## 개요\n인사.', summaryLang: 'ko' });
  });

  it('a superseded request reports and saves nothing, even if its engine keeps going', async () => {
    const old = deferred<string>();
    let oldDelta!: (d: string) => void;
    engine.summarize
      .mockImplementationOnce(((_r, onDelta) => {
        oldDelta = onDelta;
        return old.promise; // ignores the abort
      }) as Summarize)
      .mockImplementationOnce((async (_r, onDelta) => {
        onDelta('new');
        return 'new';
      }) as Summarize);

    const first = new AbortController();
    const oldText = vi.fn();
    const oldRun = generateSummary('en', first.signal, oldText);
    first.abort(); // the user asked again
    expect(await generateSummary('en', new AbortController().signal, vi.fn())).toBe(true);

    oldDelta('stale');
    old.resolve('stale');
    expect(await oldRun).toBe(false);
    expect(oldText).not.toHaveBeenCalled();
    expect(state().session?.summary).toBe('new');
  });

  it('treats an engine abort as a cancel, not a failure', async () => {
    const abort = new AbortController();
    engine.summarize.mockImplementation((async () => {
      abort.abort();
      throw new DOMException('aborted', 'AbortError');
    }) as Summarize);
    expect(await generateSummary('en', abort.signal, vi.fn())).toBe(false);
    expect(state().session?.summary).toBeUndefined();
  });

  it('fails on an empty summary without saving it', async () => {
    engine.summarize.mockImplementation((async () => '  ') as Summarize);
    const err = await generateSummary('en', new AbortController().signal, vi.fn()).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).message).toBe('The summary came back empty.');
    expect(state().session?.summary).toBeUndefined();
  });

  it('asks for the passcode when the server wants it', async () => {
    engine.summarize.mockImplementation((async () => {
      throw new EngineError('auth', 'Passcode required.', { engine: 'server' });
    }) as Summarize);
    await expect(generateSummary('en', new AbortController().signal, vi.fn())).rejects.toThrow(
      'Passcode required.',
    );
    expect(state().needsAccessToken).toBe(true);
  });
});
