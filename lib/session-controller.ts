import { MicError, saveDeviceId, savedDeviceId, savedNoiseSuppression } from './audio/devices';
import {
  micEnded,
  openAudioInput,
  savedAudioSource,
  tabEnded,
  type AudioInput,
} from './audio/sources';
import { SpeechRecorder } from './audio/vad';
import { loadVadSettings, type VadSettings } from './audio/vad-settings';
import { getEngines } from './engines/registry';
import { PipelineQueue } from './pipeline/queue';
import { getEngineChoice } from './settings/engines';
import { sessionStore } from './store/session-store';
import { ScreenWakeLock } from './wake-lock';

/** If no audio frame arrives this long after the page becomes visible, the mic was cut. */
const STALL_MS = 1500;

function waitForOnline(): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine) return Promise.resolve();
  return new Promise((resolve) =>
    window.addEventListener('online', () => resolve(), { once: true }),
  );
}

/**
 * Owns everything with a lifetime outside React for one live session: the mic recorder,
 * the job queue and the wake lock. State the UI needs goes into the session store.
 */
export class SessionController {
  readonly queue: PipelineQueue;
  private recorder: SpeechRecorder | null = null;
  private input: AudioInput | null = null;
  private readonly wakeLock = new ScreenWakeLock();
  private lastFrameAt = 0;
  private busy = false;

  constructor() {
    this.queue = new PipelineQueue({
      getState: sessionStore.getState,
      engines: getEngines,
      newId: () => crypto.randomUUID(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      waitForOnline,
    });
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private get store() {
    return sessionStore.getState();
  }

  async start() {
    if (this.busy || this.recorder) return;
    this.busy = true;
    this.store.setRecorder('starting');
    try {
      const input = await openAudioInput(savedAudioSource(), {
        deviceId: savedDeviceId(),
        noiseSuppression: savedNoiseSuppression(),
      });
      for (const track of input.micTracks) track.addEventListener('ended', this.onMicEnded);
      for (const track of input.tabTracks) track.addEventListener('ended', this.onTabEnded);
      this.input = input;
      this.recorder = await SpeechRecorder.create(input.stream, loadVadSettings(), {
        onClip: (clip) => this.queue.enqueue(clip),
        onLevel: (level) => {
          this.lastFrameAt = performance.now();
          this.store.setMicLevel(level);
        },
        onSpeaking: (speaking) => this.store.setSpeaking(speaking),
      });
      await this.recorder.start();
      this.lastFrameAt = performance.now();
      await this.wakeLock.acquire();
      this.store.setSharingStopped(false);
      this.store.setSessionEngines(getEngineChoice());
      this.store.setRecorder('listening');
    } catch (err) {
      this.recorder = null;
      this.closeInput();
      if (err instanceof MicError && err.kind === 'cancelled') {
        // Closing the tab picker is a choice, not a failure.
        this.store.setRecorder('idle');
        return;
      }
      console.error('[recorder] start failed', err);
      this.store.setRecorder(
        'error',
        err instanceof MicError
          ? { kind: err.kind, message: err.message }
          : { kind: 'vad', message: 'Could not start speech detection.' },
      );
    } finally {
      this.busy = false;
    }
  }

  async pause() {
    if (!this.recorder || this.store.recorder !== 'listening') return;
    await this.recorder.pause();
    this.store.setSpeaking(false);
    this.store.setRecorder('paused');
    await this.wakeLock.release();
  }

  async resume() {
    if (!this.recorder) return this.start();
    if (this.inputEnded()) return this.restart();
    await this.recorder.start();
    this.lastFrameAt = performance.now();
    await this.wakeLock.acquire();
    this.store.setSessionEngines(getEngineChoice());
    this.store.setRecorder('listening');
  }

  async stop() {
    const recorder = this.recorder;
    this.recorder = null;
    await recorder?.destroy(); // submits speech in progress
    this.closeInput();
    this.store.setSpeaking(false);
    this.store.setRecorder('idle');
    await this.wakeLock.release();
  }

  async switchDevice(deviceId: string | undefined) {
    saveDeviceId(deviceId);
    if (this.recorder && this.store.recorder === 'listening') await this.restart();
  }

  /** Re-applies input settings (source, device, noise suppression) to a running recorder. */
  async applyMicSettings() {
    if (this.recorder && this.store.recorder === 'listening') await this.restart();
  }

  /** Speech detection settings apply live, without reopening the input. */
  applyVadSettings(settings: VadSettings) {
    this.recorder?.updateSettings(settings);
  }

  dispose() {
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.recorder?.destroy();
    this.recorder = null;
    this.closeInput();
    this.queue.dispose();
    this.wakeLock.dispose();
  }

  private async restart() {
    const recorder = this.recorder;
    this.recorder = null;
    await recorder?.destroy();
    this.closeInput();
    await this.start();
  }

  private closeInput() {
    const input = this.input;
    this.input = null;
    if (!input) return;
    for (const track of input.micTracks) track.removeEventListener('ended', this.onMicEnded);
    for (const track of input.tabTracks) track.removeEventListener('ended', this.onTabEnded);
    input.dispose();
  }

  private inputEnded() {
    return !!this.input && (micEnded(this.input) || tabEnded(this.input));
  }

  /**
   * The user clicked "Stop sharing". Reopening would need a new share prompt (and a tap), so
   * pause instead of restarting; Resume asks to share again.
   */
  private async sharingStopped() {
    if (this.store.recorder !== 'listening') return;
    await this.pause();
    this.store.setSharingStopped(true);
  }

  private interrupted() {
    this.store.setInterrupted(true);
    void this.restart();
  }

  private onMicEnded = () => {
    // Usually the OS took the mic (phone call, locked screen). Restart once we're visible.
    if (this.store.recorder === 'listening' && document.visibilityState === 'visible') {
      this.interrupted();
    }
  };

  private onTabEnded = () => void this.sharingStopped();

  private onVisibility = () => {
    if (document.visibilityState !== 'visible' || this.store.recorder !== 'listening') return;
    if (this.input && tabEnded(this.input)) {
      void this.sharingStopped();
      return;
    }
    if (this.input && micEnded(this.input)) {
      this.interrupted();
      return;
    }
    const since = performance.now();
    setTimeout(() => {
      // Mobile browsers can silently stop delivering audio while hidden.
      if (this.store.recorder === 'listening' && this.lastFrameAt < since) this.interrupted();
    }, STALL_MS);
  };
}
