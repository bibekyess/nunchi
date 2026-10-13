import { transcribeClip, translateStream } from './api-client';
import {
  MicError,
  openMicrophone,
  saveDeviceId,
  savedDeviceId,
  savedNoiseSuppression,
} from './audio/devices';
import { SpeechRecorder } from './audio/vad';
import { encodeWav } from './audio/wav';
import { PipelineQueue } from './pipeline/queue';
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
  private readonly wakeLock = new ScreenWakeLock();
  private lastFrameAt = 0;
  private busy = false;

  constructor() {
    this.queue = new PipelineQueue({
      getState: sessionStore.getState,
      encode: (audio) => encodeWav(audio),
      transcribe: transcribeClip,
      translate: translateStream,
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
      const stream = await openMicrophone({
        deviceId: savedDeviceId(),
        noiseSuppression: savedNoiseSuppression(),
      });
      for (const track of stream.getAudioTracks()) {
        track.addEventListener('ended', this.onTrackEnded);
      }
      try {
        this.recorder = await SpeechRecorder.create(stream, {
          onClip: (clip) => this.queue.enqueue(clip),
          onLevel: (level) => {
            this.lastFrameAt = performance.now();
            this.store.setMicLevel(level);
          },
          onSpeaking: (speaking) => this.store.setSpeaking(speaking),
        });
      } catch (err) {
        stream.getTracks().forEach((t) => t.stop());
        throw err;
      }
      await this.recorder.start();
      this.lastFrameAt = performance.now();
      await this.wakeLock.acquire();
      this.store.setRecorder('listening');
    } catch (err) {
      console.error('[recorder] start failed', err);
      this.recorder = null;
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
    if (this.recorder.streamEnded) return this.restart();
    await this.recorder.start();
    this.lastFrameAt = performance.now();
    await this.wakeLock.acquire();
    this.store.setRecorder('listening');
  }

  async stop() {
    const recorder = this.recorder;
    this.recorder = null;
    await recorder?.destroy(); // submits speech in progress
    this.store.setSpeaking(false);
    this.store.setRecorder('idle');
    await this.wakeLock.release();
  }

  async switchDevice(deviceId: string | undefined) {
    saveDeviceId(deviceId);
    if (this.recorder && this.store.recorder === 'listening') await this.restart();
  }

  /** Re-applies mic settings (device, noise suppression) to a running recorder. */
  async applyMicSettings() {
    if (this.recorder && this.store.recorder === 'listening') await this.restart();
  }

  dispose() {
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.recorder?.destroy();
    this.recorder = null;
    this.queue.dispose();
    this.wakeLock.dispose();
  }

  private async restart() {
    const recorder = this.recorder;
    this.recorder = null;
    await recorder?.destroy();
    await this.start();
  }

  private interrupted() {
    this.store.setInterrupted(true);
    void this.restart();
  }

  private onTrackEnded = () => {
    // Usually the OS took the mic (phone call, locked screen). Restart once we're visible.
    if (this.store.recorder === 'listening' && document.visibilityState === 'visible') {
      this.interrupted();
    }
  };

  private onVisibility = () => {
    if (document.visibilityState !== 'visible' || this.store.recorder !== 'listening') return;
    if (this.recorder?.streamEnded) {
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
