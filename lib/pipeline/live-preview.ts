import type { SpeechEngine, TranscribeOptions } from '@/lib/engines/types';
import { samplesToMs } from '@/lib/audio/wav';
import { hallucinationReason } from './hallucinations';

/** How often the speech in progress is transcribed again while someone talks. */
export const PREVIEW_INTERVAL_MS = 1000;
/** Shorter than this, Whisper mostly guesses; wait for more audio. */
export const PREVIEW_MIN_MS = 700;

export interface LivePreviewDeps {
  /** Audio of the speech in progress, or null between lines. */
  audio: () => Float32Array | null;
  speech: () => SpeechEngine;
  /** Language, prompt and hint for the line being spoken. */
  options: () => Omit<TranscribeOptions, 'signal' | 'words'>;
  /** The text of the line before, to drop a draft that just repeats it. */
  previousText: () => string | undefined;
  /** False skips a round: drafts are off, offline, or the real queue is backed up. */
  canRun: () => boolean;
  /** The draft of the line being spoken ('' clears it). */
  onDraft: (text: string) => void;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
}

/**
 * While someone is speaking, transcribes what they've said so far about once a second, so the
 * words show up (faintly) before the pause that ends the line. One request at a time; a
 * draft is only a preview and every failure is ignored. The final transcription of the clip
 * replaces it.
 */
export class LivePreview {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: AbortController | null = null;
  /** Bumped per line: a reply for an older line is dropped. */
  private line = 0;
  private speaking = false;
  private draft = '';
  /** Where a reply still in flight goes once its line has become a row. */
  private late: ((text: string) => void) | null = null;

  constructor(private readonly deps: LivePreviewDeps) {}

  /** Speech started: begin drafting a new line. */
  begin() {
    this.reset();
    this.speaking = true;
    const every = this.deps.setInterval ?? globalThis.setInterval;
    this.timer = every(() => void this.tick(), PREVIEW_INTERVAL_MS);
  }

  /** Speech stopped. The draft is kept for the clip that usually follows (see `take`). */
  pause() {
    this.speaking = false;
    this.clearTimer();
    this.deps.onDraft('');
  }

  /**
   * The line became a clip: returns its latest draft. A reply still on its way is handed to
   * `late` instead, so the new row can show it.
   */
  take(late: (text: string) => void): string {
    const draft = this.draft;
    this.draft = '';
    if (this.inFlight) this.late = late;
    return draft;
  }

  /** Recording stopped or the session closed. */
  stop() {
    this.reset();
    this.deps.onDraft('');
  }

  private reset() {
    this.line++;
    this.speaking = false;
    this.clearTimer();
    this.inFlight?.abort();
    this.inFlight = null;
    this.draft = '';
    this.late = null;
  }

  private clearTimer() {
    if (this.timer === null) return;
    (this.deps.clearInterval ?? globalThis.clearInterval)(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.inFlight || !this.speaking || !this.deps.canRun()) return;
    const audio = this.deps.audio();
    if (!audio || samplesToMs(audio.length) < PREVIEW_MIN_MS) return;

    const line = this.line;
    const job = new AbortController();
    this.inFlight = job;
    let text: string | undefined;
    try {
      const result = await this.deps.speech().transcribe(audio, {
        ...this.deps.options(),
        signal: job.signal,
      });
      const junk = hallucinationReason({
        result,
        clipDurationMs: samplesToMs(audio.length),
        previousText: this.deps.previousText(),
      });
      text = junk ? undefined : result.text.trim();
    } catch {
      // A draft is a nicety: the clip's own transcription reports real failures.
    } finally {
      if (this.inFlight === job) this.inFlight = null;
    }
    if (line !== this.line || !text) return;
    if (this.late) {
      const late = this.late;
      this.late = null;
      late(text);
    } else {
      this.draft = text;
      if (this.speaking) this.deps.onDraft(text);
    }
  }
}
