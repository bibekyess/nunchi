import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type TranslateRequest } from '@/lib/api-client';
import { PipelineQueue, type QueueDeps } from '@/lib/pipeline/queue';
import { sessionStore } from '@/lib/store/session-store';
import type { TranscriptionResult } from '@/lib/types';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tr = (text: string, language = 'ko'): TranscriptionResult => ({
  text,
  language,
  durationMs: 1000,
  segments: [{ text, noSpeechProb: 0.01, avgLogprob: -0.2 }],
});

const clip = (ms = 1500) => ({ audio: new Float32Array(16 * ms), startedAt: 0, durationMs: ms });

/** Lets queued promise chains run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

let n = 0;
function makeDeps(over: Partial<QueueDeps> = {}): QueueDeps {
  return {
    getState: sessionStore.getState,
    transcribe: vi.fn(async () => tr('안녕하세요.')),
    translate: vi.fn(async (_body: TranslateRequest, onDelta: (d: string) => void) => {
      onDelta('Hello.');
      return 'Hello.';
    }),
    newId: () => `u${n++}`,
    sleep: vi.fn(async () => {}),
    waitForOnline: async () => {},
    ...over,
  };
}

const state = () => sessionStore.getState();
const ordered = () => state().ids.map((id) => state().byId[id]);

beforeEach(() => {
  n = 0;
  sessionStore.setState({ session: null });
  state().startSession(`s${Math.random()}`);
});

describe('PipelineQueue', () => {
  it('adds a placeholder immediately, then fills in source and translation', async () => {
    const deps = makeDeps();
    const q = new PipelineQueue(deps);
    const c = clip();
    const id = q.enqueue(c);
    expect(state().byId[id]).toMatchObject({ seq: 0, status: 'transcribing', durationMs: 1500 });

    await flush();
    expect(state().byId[id]).toMatchObject({
      status: 'done',
      sourceText: '안녕하세요.',
      sourceLang: 'ko',
      targetLang: 'en',
      translation: 'Hello.',
    });
    expect(q.pendingClips).toBe(0); // audio discarded after transcription
    // Engines get the raw samples and encode them as they need.
    expect(deps.transcribe).toHaveBeenCalledWith(
      c.audio,
      expect.objectContaining({ language: 'auto' }),
    );
  });

  it('keeps speech order when responses arrive out of order', async () => {
    const first = deferred<TranscriptionResult>();
    const second = deferred<TranscriptionResult>();
    const transcribe = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const translate = vi.fn(async (body: TranslateRequest, onDelta: (d: string) => void) => {
      onDelta(`EN(${body.text})`);
      return `EN(${body.text})`;
    });
    const q = new PipelineQueue(makeDeps({ transcribe, translate }));
    q.enqueue(clip());
    q.enqueue(clip());

    second.resolve(tr('두 번째'));
    await flush();
    expect(ordered().map((u) => u.status)).toEqual(['transcribing', 'done']);

    first.resolve(tr('첫 번째'));
    await flush();
    expect(ordered().map((u) => [u.seq, u.sourceText, u.translation])).toEqual([
      [0, '첫 번째', 'EN(첫 번째)'],
      [1, '두 번째', 'EN(두 번째)'],
    ]);
  });

  it('runs at most two transcriptions at once', async () => {
    const gates = [
      deferred<TranscriptionResult>(),
      deferred<TranscriptionResult>(),
      deferred<TranscriptionResult>(),
    ];
    let i = 0;
    const transcribe = vi.fn(() => gates[i++].promise);
    const q = new PipelineQueue(makeDeps({ transcribe }));
    q.enqueue(clip());
    q.enqueue(clip());
    q.enqueue(clip());
    await flush();
    expect(transcribe).toHaveBeenCalledTimes(2);
    gates[0].resolve(tr('하나'));
    await flush();
    expect(transcribe).toHaveBeenCalledTimes(3);
  });

  it('retries network and 5xx errors with backoff, then shows an error with retry', async () => {
    const sleep = vi.fn(async () => {});
    const transcribe = vi.fn(async (): Promise<TranscriptionResult> => {
      throw new ApiError(502, 'upstream_error', 'The speaches server returned an error.');
    });
    const deps = makeDeps({ transcribe, sleep });
    const q = new PipelineQueue(deps);
    const id = q.enqueue(clip());
    await flush();

    expect(transcribe).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [3000]]);
    expect(state().byId[id]).toMatchObject({ status: 'error' });
    expect(q.canRetry(id)).toBe(true);

    transcribe.mockImplementation(async () => tr('다시'));
    q.retry(id);
    await flush();
    expect(state().byId[id]).toMatchObject({ status: 'done', sourceText: '다시' });
  });

  it('does not retry 4xx errors and flags a missing access token', async () => {
    const transcribe = vi.fn(async () => {
      throw new ApiError(401, 'unauthorized', 'Missing or wrong access token.');
    });
    const q = new PipelineQueue(makeDeps({ transcribe }));
    const id = q.enqueue(clip());
    await flush();
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(state().byId[id].status).toBe('error');
    expect(state().needsAccessToken).toBe(true);
  });

  it('skips hallucinated filler without translating it', async () => {
    const translate = vi.fn();
    const q = new PipelineQueue(
      makeDeps({ transcribe: vi.fn(async () => tr('시청해주셔서 감사합니다.')), translate }),
    );
    const id = q.enqueue(clip(3000));
    await flush();
    expect(state().byId[id].status).toBe('skipped');
    expect(translate).not.toHaveBeenCalled();
  });

  it('translates English to Korean in auto mode', async () => {
    const translate = vi.fn(async (body: TranslateRequest) => {
      expect(body).toMatchObject({ sourceLang: 'en', targetLang: 'ko' });
      return '네.';
    });
    const q = new PipelineQueue(
      makeDeps({ transcribe: vi.fn(async () => tr('Yes.', 'en')), translate }),
    );
    const id = q.enqueue(clip());
    await flush();
    expect(state().byId[id]).toMatchObject({ status: 'done', translation: '네.' });
  });

  it('sends the five most recent finished lines as context, and the glossary', async () => {
    state().setGlossary([{ term: '키로', translation: 'Kiro' }]);
    const bodies: TranslateRequest[] = [];
    const transcribe = vi.fn();
    for (let i = 0; i < 7; i++) transcribe.mockResolvedValueOnce(tr(`문장 ${i}`));
    const translate = vi.fn(async (body: TranslateRequest) => {
      bodies.push(body);
      return `Line ${body.text.slice(3)}`;
    });
    const q = new PipelineQueue(makeDeps({ transcribe, translate }));
    for (let i = 0; i < 7; i++) {
      q.enqueue(clip());
      await flush();
    }
    const last = bodies.at(-1)!;
    expect(last.context.map((c) => c.source)).toEqual([
      '문장 1',
      '문장 2',
      '문장 3',
      '문장 4',
      '문장 5',
    ]);
    expect(last.glossary).toEqual([{ term: '키로', translation: 'Kiro' }]);
    // The Whisper prompt carries glossary terms and the previous sentence.
    expect(transcribe.mock.calls.at(-1)?.[1]).toMatchObject({ prompt: '키로. 문장 5' });
  });

  it('retries once at temperature 0 when the translation comes back untranslated', async () => {
    const translate = vi.fn().mockResolvedValueOnce('안녕하세요.').mockResolvedValueOnce('Hello.');
    const q = new PipelineQueue(makeDeps({ translate }));
    const id = q.enqueue(clip());
    await flush();
    expect(translate).toHaveBeenCalledTimes(2);
    expect(translate.mock.calls[1][0]).toMatchObject({ retry: true });
    expect(state().byId[id].translation).toBe('Hello.');
  });

  it('restarts a translation that failed mid-stream', async () => {
    let call = 0;
    const translate = vi.fn(async (_b: TranslateRequest, onDelta: (d: string) => void) => {
      onDelta('Hel');
      if (call++ === 0) throw new ApiError(0, 'stream_interrupted', 'interrupted');
      onDelta('lo.');
      return 'Hello.';
    });
    const q = new PipelineQueue(makeDeps({ translate }));
    const id = q.enqueue(clip());
    await flush();
    expect(state().byId[id]).toMatchObject({ status: 'done', translation: 'Hello.' });
  });

  it('waits for the network before sending', async () => {
    const online = deferred<void>();
    const transcribe = vi.fn(async () => tr('네.'));
    const q = new PipelineQueue(makeDeps({ transcribe, waitForOnline: () => online.promise }));
    q.enqueue(clip());
    await flush();
    expect(transcribe).not.toHaveBeenCalled();
    online.resolve();
    await flush();
    expect(transcribe).toHaveBeenCalled();
  });

  it('stops updating the store after dispose', async () => {
    const gate = deferred<TranscriptionResult>();
    const q = new PipelineQueue(makeDeps({ transcribe: () => gate.promise }));
    const id = q.enqueue(clip());
    q.dispose();
    gate.resolve(tr('늦은 답'));
    await flush();
    expect(state().byId[id].status).toBe('transcribing');
  });
});
