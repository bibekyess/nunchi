import type { Engines, TranslateRequest } from '@/lib/engines/types';
import type { Clip } from '@/lib/audio/vad';
import { EngineError } from '@/lib/errors';
import type { SessionState } from '@/lib/store/session-store';
import type { TranscriptionResult, TranslationContextItem, Utterance } from '@/lib/types';
import { Semaphore } from '@/lib/util/concurrency';
import { pickDirection } from './direction';
import { hallucinationReason } from './hallucinations';
import { buildWhisperPrompt } from './whisper-prompt';

export const CONCURRENCY = 2;
export const BACKOFF_MS = [1000, 3000];
export const CONTEXT_LINES = 5;
export const MAX_PENDING_CLIPS = 50; // ~15 MB of audio

export interface QueueDeps {
  getState: () => SessionState;
  /** The engines chosen right now; read per job, so a change applies from the next line. */
  engines: () => Pick<Engines, 'speech' | 'translate'>;
  newId: () => string;
  sleep: (ms: number) => Promise<void>;
  /** Resolves once the browser is online (at once if it already is); rejects when `signal` aborts. */
  waitForOnline: (signal?: AbortSignal) => Promise<void>;
}

/** Thrown inside a job whose clip was dropped; ends the job without touching its row. */
const dropped = () => new DOMException('The clip was dropped.', 'AbortError');

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * One job per utterance clip: transcribe → filter → translate (streamed). Jobs run with
 * limited concurrency and may finish out of order; the UI always renders by `seq`.
 */
export class PipelineQueue {
  private nextSeq = 0;
  /** Audio is kept only until transcription succeeds, for retries. Never persisted. */
  private readonly clips = new Map<string, Clip>();
  /** Cancels the transcription job of each utterance that has one running or waiting. */
  private readonly jobs = new Map<string, AbortController>();
  private readonly transcribeSlots = new Semaphore(CONCURRENCY);
  private readonly translateSlots = new Semaphore(CONCURRENCY);
  private readonly abort = new AbortController();

  constructor(private readonly deps: QueueDeps) {
    const ids = deps.getState().ids;
    const byId = deps.getState().byId;
    // Continue numbering after anything already in the session.
    this.nextSeq = ids.length ? byId[ids[ids.length - 1]].seq + 1 : 0;
  }

  get pendingClips() {
    return this.clips.size;
  }

  /** Adds a clip as a new utterance and starts its job. Returns its id ('' once disposed). */
  enqueue(clip: Clip): string {
    // A recorder can still deliver a clip while the session is being torn down.
    if (this.signal.aborted) return '';
    const { session, addUtterance } = this.deps.getState();
    const id = this.deps.newId();
    addUtterance({
      id,
      sessionId: session?.id ?? '',
      seq: this.nextSeq++,
      startedAt: clip.startedAt,
      durationMs: clip.durationMs,
      status: 'transcribing',
    });
    this.clips.set(id, clip);
    this.evictOldClips();
    void this.runTranscribe(id);
    return id;
  }

  /** Retry a failed utterance from wherever it failed. */
  retry(id: string) {
    const u = this.deps.getState().byId[id];
    if (!u || u.status !== 'error') return;
    if (this.clips.has(id)) void this.runTranscribe(id);
    else if (u.sourceText && u.sourceLang && u.targetLang) void this.runTranslate(id);
  }

  retryAllFailed() {
    const { ids, byId } = this.deps.getState();
    for (const id of ids) if (byId[id].status === 'error') this.retry(id);
  }

  failedCount(): number {
    const { ids, byId } = this.deps.getState();
    return ids.filter((id) => byId[id].status === 'error').length;
  }

  canRetry(id: string): boolean {
    const u = this.deps.getState().byId[id];
    return Boolean(u && (this.clips.has(id) || u.sourceText));
  }

  dispose() {
    this.abort.abort();
    this.clips.clear();
    this.jobs.clear();
  }

  private get signal() {
    return this.abort.signal;
  }

  private patch(id: string, patch: Partial<Utterance>) {
    if (!this.signal.aborted) this.deps.getState().patchUtterance(id, patch);
  }

  private fail(id: string, err: unknown) {
    if (this.signal.aborted || (err as Error)?.name === 'AbortError') return;
    if (err instanceof EngineError && err.needsPasscode) {
      this.deps.getState().setNeedsAccessToken(true);
    }
    const message = err instanceof EngineError ? err.message : 'Something went wrong';
    this.patch(id, { status: 'error', error: message });
  }

  /**
   * Runs `attempt` with retries for network/5xx errors. Engines that need the network wait
   * for connectivity first; on-device ones run offline. `signal` ends the wait.
   */
  private async withRetries<T>(
    engine: { needsNetwork: boolean },
    attempt: () => Promise<T>,
    signal: AbortSignal = this.signal,
  ): Promise<T> {
    for (let i = 0; ; i++) {
      if (engine.needsNetwork) await this.deps.waitForOnline(signal);
      try {
        return await attempt();
      } catch (err) {
        const retryable = err instanceof EngineError && err.retryable;
        if (!retryable || i >= BACKOFF_MS.length || signal.aborted) throw err;
        await this.deps.sleep(BACKOFF_MS[i]);
      }
    }
  }

  /**
   * Past the cap, the oldest clips are dropped: their audio is let go and their jobs are
   * cancelled, so a dropped line is never sent later and keeps its error.
   */
  private evictOldClips() {
    while (this.clips.size > MAX_PENDING_CLIPS) {
      const oldest = this.clips.keys().next().value as string;
      this.clips.delete(oldest);
      this.jobs.get(oldest)?.abort();
      this.jobs.delete(oldest);
      this.patch(oldest, {
        status: 'error',
        error: 'Dropped: too many clips waiting for the network',
      });
    }
  }

  private previousSource(seq: number): string | undefined {
    const { ids, byId } = this.deps.getState();
    for (let i = ids.length - 1; i >= 0; i--) {
      const u = byId[ids[i]];
      if (u.seq < seq && u.sourceText && u.status !== 'skipped') return u.sourceText;
    }
    return undefined;
  }

  private context(seq: number): TranslationContextItem[] {
    const { ids, byId } = this.deps.getState();
    const items: TranslationContextItem[] = [];
    for (let i = ids.length - 1; i >= 0 && items.length < CONTEXT_LINES; i--) {
      const u = byId[ids[i]];
      if (u.seq < seq && u.status === 'done' && u.sourceText && u.translation) {
        items.unshift({ source: u.sourceText, translation: u.translation });
      }
    }
    return items;
  }

  private async runTranscribe(id: string) {
    const state = this.deps.getState();
    const u = state.byId[id];
    // Only the duration is kept here: the audio is looked up when it is sent, so a dropped
    // clip is not held in memory by its waiting job.
    const clipDurationMs = this.clips.get(id)?.durationMs;
    if (clipDurationMs === undefined || !u || !state.session) return;
    this.patch(id, { status: 'transcribing', error: undefined });

    this.jobs.get(id)?.abort();
    const job = new AbortController();
    this.jobs.set(id, job);
    const signal = AbortSignal.any([this.signal, job.signal]);
    /** The clip's audio, or a stop if it was dropped while this job waited. */
    const audio = () => {
      const clip = this.clips.get(id);
      if (!clip || signal.aborted) throw dropped();
      return clip.audio;
    };

    const { mode, glossary } = state.session;
    const speech = this.deps.engines().speech;
    let result: TranscriptionResult;
    try {
      result = await this.transcribeSlots.run(() =>
        this.withRetries(
          speech,
          async () =>
            speech.transcribe(audio(), {
              language: mode.source,
              prompt: buildWhisperPrompt(glossary, this.previousSource(u.seq)),
              signal,
            }),
          signal,
        ),
      );
    } catch (err) {
      if (!job.signal.aborted) this.fail(id, err); // a dropped clip keeps its error
      return;
    } finally {
      if (this.jobs.get(id) === job) this.jobs.delete(id);
    }
    if (signal.aborted) return;
    this.clips.delete(id); // transcription succeeded; audio is no longer needed

    const reason = hallucinationReason({
      result,
      clipDurationMs,
      previousText: this.previousSource(u.seq),
    });
    if (reason) {
      this.patch(id, { status: 'skipped', sourceText: result.text || undefined });
      return;
    }

    const { sourceLang, targetLang } = pickDirection(
      this.deps.getState().session?.mode ?? mode,
      result.language,
    );
    this.patch(id, { sourceText: result.text, sourceLang, targetLang, status: 'translating' });
    await this.runTranslate(id);
  }

  private async runTranslate(id: string) {
    const state = this.deps.getState();
    const u = state.byId[id];
    if (!u?.sourceText || !u.sourceLang || !u.targetLang || !state.session) return;
    this.patch(id, { status: 'translating', translation: '', error: undefined });

    const body: TranslateRequest = {
      text: u.sourceText,
      sourceLang: u.sourceLang,
      targetLang: u.targetLang,
      context: this.context(u.seq),
      glossary: state.session.glossary,
      meetingContext: state.session.meetingContext,
    };
    const append = (delta: string) => {
      if (!this.signal.aborted) this.deps.getState().appendTranslation(id, delta);
    };
    const translator = this.deps.engines().translate;
    const streamOnce = (request: TranslateRequest) =>
      this.withRetries(translator, async () => {
        this.patch(id, { translation: '' }); // a retried stream starts over
        return translator.translate(request, append, this.signal);
      });

    try {
      let text = await this.translateSlots.run(() => streamOnce(body));
      const untranslated =
        text.trim() === '' ||
        (u.sourceLang !== u.targetLang && normalize(text) === normalize(u.sourceText));
      if (untranslated) {
        text = await this.translateSlots.run(() => streamOnce({ ...body, retry: true }));
      }
      this.patch(id, { status: 'done', translation: text.trim() });
    } catch (err) {
      this.fail(id, err);
    }
  }
}
