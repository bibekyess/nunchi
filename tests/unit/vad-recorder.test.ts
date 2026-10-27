// The 25 s force-split pauses and restarts speech detection. If the recorder is destroyed in
// between (Stop, leaving the page), the restart must not throw an unhandled rejection.
import { afterEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const state: {
    options: Record<string, (...args: unknown[]) => unknown> | null;
    /** Resolvers of pause() calls still running, oldest first. */
    pauses: (() => void)[];
  } = { options: null, pauses: [] };
  const vad = {
    start: vi.fn(async () => {}),
    pause: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          state.pauses.push(resolve);
        }),
    ),
    destroy: vi.fn(async () => {}),
    setOptions: vi.fn(),
  };
  return { state, vad };
});

vi.mock('@ricky0123/vad-web', () => ({
  MicVAD: {
    new: async (options: Record<string, (...args: unknown[]) => unknown>) => {
      fake.state.options = options;
      return fake.vad;
    },
  },
}));

const { MAX_UTTERANCE_MS, SPLIT_AT_PAUSE_MS, SpeechRecorder } = await import('@/lib/audio/vad');
const { DEFAULT_VAD_SETTINGS } = await import('@/lib/audio/vad-settings');

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SpeechRecorder force-split', () => {
  it('does not restart (or throw) when destroyed while pausing', async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const recorder = await SpeechRecorder.create({} as MediaStream, DEFAULT_VAD_SETTINGS, {
        onClip: vi.fn(),
      });
      fake.state.options!.onSpeechStart();
      await vi.advanceTimersByTimeAsync(MAX_UTTERANCE_MS); // force-split begins: pause()
      expect(fake.vad.pause).toHaveBeenCalledTimes(1);

      await recorder.destroy(); // Stop pressed while the pause is still running
      fake.state.pauses.splice(0).forEach((release) => release());
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 10));

      expect(fake.vad.start).not.toHaveBeenCalled();
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('stays paused when the user pauses during a force-split', async () => {
    vi.useFakeTimers();
    fake.vad.start.mockClear();
    fake.vad.pause.mockClear();
    const recorder = await SpeechRecorder.create({} as MediaStream, DEFAULT_VAD_SETTINGS, {
      onClip: vi.fn(),
    });
    await recorder.start();
    fake.vad.start.mockClear();
    fake.state.options!.onSpeechStart();
    await vi.advanceTimersByTimeAsync(MAX_UTTERANCE_MS);
    const pausing = recorder.pause(); // the user's pause, while the split's pause runs
    expect(fake.state.pauses).toHaveLength(2);
    fake.state.pauses.splice(0).forEach((release) => release());
    await pausing;
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 10));
    expect(fake.vad.start).not.toHaveBeenCalled();
  });
});

describe('SpeechRecorder split at a pause', () => {
  const frame = new Float32Array(512);
  const quiet = { isSpeech: 0.1, notSpeech: 0.9 };
  const talking = { isSpeech: 0.9, notSpeech: 0.1 };

  it('splits a long line at its first quiet frame, once', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    fake.vad.pause.mockClear();
    const recorder = await SpeechRecorder.create({} as MediaStream, DEFAULT_VAD_SETTINGS, {
      onClip: vi.fn(),
    });
    await recorder.start();
    const { onSpeechStart, onFrameProcessed } = fake.state.options!;

    onSpeechStart();
    onFrameProcessed(quiet, frame); // a pause this early ends nothing
    now = SPLIT_AT_PAUSE_MS;
    onFrameProcessed(talking, frame);
    expect(fake.vad.pause).not.toHaveBeenCalled();

    onFrameProcessed(quiet, frame);
    onFrameProcessed(quiet, frame); // one split at a time
    expect(fake.vad.pause).toHaveBeenCalledTimes(1);
    fake.state.pauses.splice(0).forEach((release) => release());
    await recorder.destroy();
  });
});
