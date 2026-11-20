import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechEngine } from '@/lib/engines/types';
import {
  LivePreview,
  PREVIEW_INTERVAL_MS,
  type LivePreviewDeps,
} from '@/lib/pipeline/live-preview';
import type { TranscriptionResult } from '@/lib/types';

const tr = (text: string): TranscriptionResult => ({
  text,
  language: 'ko',
  durationMs: 1000,
  segments: [{ text, noSpeechProb: 0.01, avgLogprob: -0.2 }],
});

const audio = (ms: number) => new Float32Array(16 * ms);

function setup(over: Partial<LivePreviewDeps> & { transcribe?: SpeechEngine['transcribe'] } = {}) {
  const { transcribe = vi.fn(async () => tr('안녕하세요')), ...rest } = over;
  const drafts: string[] = [];
  let speech: Float32Array | null = audio(1500);
  const deps: LivePreviewDeps = {
    audio: () => speech,
    speech: () => ({
      id: 'server',
      needsNetwork: true,
      status: async () => ({ state: 'ready' }),
      transcribe,
    }),
    options: () => ({ language: 'auto' }),
    previousText: () => undefined,
    canRun: () => true,
    onDraft: (t) => drafts.push(t),
    ...rest,
  };
  return {
    preview: new LivePreview(deps),
    drafts,
    transcribe,
    setAudio: (a: Float32Array | null) => (speech = a),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('LivePreview', () => {
  it('drafts the speech in progress about once a second', async () => {
    const { preview, drafts, transcribe } = setup();
    preview.begin();
    await vi.advanceTimersByTimeAsync(PREVIEW_INTERVAL_MS);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(drafts).toEqual(['안녕하세요']);
    await vi.advanceTimersByTimeAsync(PREVIEW_INTERVAL_MS);
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it('waits for enough audio, and skips rounds it may not run', async () => {
    let allowed = false;
    const { preview, transcribe, setAudio } = setup({ canRun: () => allowed });
    preview.begin();
    await vi.advanceTimersByTimeAsync(PREVIEW_INTERVAL_MS);
    expect(transcribe).not.toHaveBeenCalled();
    allowed = true;
    setAudio(audio(300));
    await vi.advanceTimersByTimeAsync(PREVIEW_INTERVAL_MS);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('keeps one request at a time', async () => {
    const transcribe = vi.fn(() => new Promise<TranscriptionResult>(() => {}));
    const { preview } = setup({ transcribe });
    preview.begin();
    await vi.advanceTimersByTimeAsync(PREVIEW_INTERVAL_MS * 3);
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it('ignores filler and failures', async () => {
    const transcribe = vi
      .fn<SpeechEngine['transcribe']>()
      .mockResolvedValueOnce(tr('시청해주셔서 감사합니다'))
      .mockRejectedValueOnce(new Error('down'));
    const { preview, drafts } = setup({ transcribe });
    preview.begin();
    await vi.advanceTimersByTimeAsync(PREVIEW_INTERVAL_MS * 2);
    expect(drafts).toEqual([]);
  });

  it('hands the last draft to the clip, and a late reply to its row', async () => {
    let release!: (r: TranscriptionResult) => void;
    const transcribe = vi
      .fn<SpeechEngine['transcribe']>()
      .mockResolvedValueOnce(tr('안녕'))
      .mockImplementationOnce(() => new Promise((r) => (release = r)));
    const { preview, drafts } = setup({ transcribe });
    preview.begin();
    await vi.advanceTimersByTimeAsync(PREVIEW_INTERVAL_MS * 2); // second request in flight
    preview.pause();
    expect(drafts.at(-1)).toBe(''); // the live line goes away

    const late = vi.fn();
    expect(preview.take(late)).toBe('안녕');
    release(tr('안녕하세요'));
    await vi.advanceTimersByTimeAsync(0);
    expect(late).toHaveBeenCalledWith('안녕하세요');
  });

  it('drops replies for a line that was abandoned', async () => {
    let release!: (r: TranscriptionResult) => void;
    const transcribe = vi.fn(() => new Promise<TranscriptionResult>((r) => (release = r)));
    const { preview, drafts } = setup({ transcribe });
    preview.begin();
    await vi.advanceTimersByTimeAsync(PREVIEW_INTERVAL_MS);
    preview.stop();
    release(tr('안녕하세요'));
    await vi.advanceTimersByTimeAsync(0);
    expect(drafts).toEqual(['']);
    expect(preview.take(vi.fn())).toBe('');
  });
});
