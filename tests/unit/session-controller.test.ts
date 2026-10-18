// Review finding B: leaving a session while listening is still starting must not leave the
// microphone (and speech detection) running in the background.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioInput } from '@/lib/audio/sources';
import type { SpeechRecorder } from '@/lib/audio/vad';
import { sessionStore } from '@/lib/session/store';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const mocks = vi.hoisted(() => ({
  openAudioInput: vi.fn(),
  createRecorder: vi.fn(),
}));

vi.mock('@/lib/audio/sources', () => ({
  openAudioInput: mocks.openAudioInput,
  savedAudioSource: () => 'mic',
  micEnded: () => false,
  tabEnded: () => false,
}));

vi.mock('@/lib/audio/vad', () => ({
  SpeechRecorder: { create: mocks.createRecorder },
}));

const { SessionController } = await import('@/lib/session/controller');

function fakeInput(): AudioInput {
  return {
    source: 'mic',
    stream: {} as MediaStream,
    micTracks: [],
    tabTracks: [],
    dispose: vi.fn(),
  };
}

function fakeRecorder() {
  return {
    start: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
    updateSettings: vi.fn(),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    visibilityState: 'visible',
  });
  mocks.openAudioInput.mockReset();
  mocks.createRecorder.mockReset();
  sessionStore.setState({ session: null });
  sessionStore.getState().startSession(`s${Math.random()}`);
});

afterEach(() => vi.unstubAllGlobals());

describe('SessionController', () => {
  it('closes the microphone it was still opening when disposed', async () => {
    const opening = deferred<AudioInput>();
    mocks.openAudioInput.mockReturnValue(opening.promise);
    const controller = new SessionController();
    const started = controller.start();
    controller.dispose();

    const input = fakeInput();
    opening.resolve(input);
    await started;

    expect(input.dispose).toHaveBeenCalled();
    expect(mocks.createRecorder).not.toHaveBeenCalled();
    expect(sessionStore.getState().recorder).not.toBe('listening');
  });

  it('tears down speech detection that finished loading after dispose', async () => {
    const input = fakeInput();
    mocks.openAudioInput.mockResolvedValue(input);
    const loading = deferred<SpeechRecorder>();
    mocks.createRecorder.mockReturnValue(loading.promise);
    const controller = new SessionController();
    const started = controller.start();
    await flush(); // the mic is open; speech detection is loading
    controller.dispose();

    const recorder = fakeRecorder();
    loading.resolve(recorder as unknown as SpeechRecorder);
    await started;

    expect(recorder.start).not.toHaveBeenCalled();
    expect(recorder.destroy).toHaveBeenCalled();
    expect(input.dispose).toHaveBeenCalled();
    expect(sessionStore.getState().recorder).not.toBe('listening');
  });

  it('does not reopen the microphone when resumed after dispose', async () => {
    const controller = new SessionController();
    controller.dispose();
    await controller.resume();
    expect(mocks.openAudioInput).not.toHaveBeenCalled();
  });

  it('drops a pending stall check when disposed', async () => {
    vi.useFakeTimers();
    try {
      mocks.openAudioInput.mockResolvedValue(fakeInput());
      mocks.createRecorder.mockResolvedValue(fakeRecorder());
      const controller = new SessionController();
      await controller.start();
      vi.advanceTimersByTime(100); // no audio frame since starting
      // Back to the page: a stall check is scheduled.
      for (const [type, listener] of vi.mocked(document.addEventListener).mock.calls) {
        if (type === 'visibilitychange') (listener as () => void)();
      }
      controller.dispose();
      // The next session is listening when the old check would have fired.
      sessionStore.getState().startSession(`next${Math.random()}`);
      sessionStore.getState().setRecorder('listening');
      await vi.runAllTimersAsync();
      expect(sessionStore.getState().interrupted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts normally when nothing interrupts it', async () => {
    const input = fakeInput();
    const recorder = fakeRecorder();
    mocks.openAudioInput.mockResolvedValue(input);
    mocks.createRecorder.mockResolvedValue(recorder);
    const controller = new SessionController();
    await controller.start();
    expect(recorder.start).toHaveBeenCalled();
    expect(sessionStore.getState().recorder).toBe('listening');
    controller.dispose();
    expect(recorder.destroy).toHaveBeenCalled();
    expect(input.dispose).toHaveBeenCalled();
  });
});
