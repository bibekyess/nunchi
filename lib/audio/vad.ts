import type { MicVAD } from '@ricky0123/vad-web';
import { toMicVadOptions, type VadSettings } from './vad-settings';
import { frameLevel, samplesToMs } from './wav';

const ASSET_PATH = '/vad/';

export const MAX_UTTERANCE_MS = 25_000; // Whisper's hard limit is 30 s

export interface Clip {
  audio: Float32Array; // 16 kHz mono
  /** ms since the recorder started, at speech start (approximate). */
  startedAt: number;
  durationMs: number;
}

export interface SpeechRecorderCallbacks {
  onClip: (clip: Clip) => void;
  onLevel?: (level: number) => void;
  onSpeaking?: (speaking: boolean) => void;
}

/**
 * Wraps MicVAD around a stream the caller opened and closes, so pausing never stops the tracks
 * (no new permission prompt on resume) and long monologues can be force-split.
 */
export class SpeechRecorder {
  private vad: MicVAD | null = null;
  private speechStartedAt: number | null = null;
  private splitTimer: ReturnType<typeof setTimeout> | null = null;
  /** Between start() and pause()/destroy(); a force-split only restarts while this holds. */
  private listening = false;
  private readonly t0 = performance.now();

  private constructor(private readonly callbacks: SpeechRecorderCallbacks) {}

  static async create(
    stream: MediaStream,
    settings: VadSettings,
    callbacks: SpeechRecorderCallbacks,
  ): Promise<SpeechRecorder> {
    const recorder = new SpeechRecorder(callbacks);
    // Loaded lazily: the model + WASM are ~16 MB and only needed once recording starts.
    const { MicVAD } = await import('@ricky0123/vad-web');
    recorder.vad = await MicVAD.new({
      model: 'v5',
      baseAssetPath: ASSET_PATH,
      onnxWASMBasePath: ASSET_PATH,
      ortConfig: (ort) => {
        ort.env.logLevel = 'error';
        ort.env.wasm.numThreads = 1; // threads need cross-origin isolation; one is plenty for VAD
      },
      ...toMicVadOptions(settings),
      submitUserSpeechOnPause: true,
      startOnLoad: false,
      getStream: async () => stream,
      pauseStream: async () => {},
      resumeStream: async () => stream,
      onFrameProcessed: (_probs, frame) => callbacks.onLevel?.(frameLevel(frame)),
      onSpeechStart: () => recorder.handleSpeechStart(),
      onVADMisfire: () => recorder.handleSpeechStop(),
      onSpeechEnd: (audio) => recorder.handleSpeechEnd(audio),
    });
    return recorder;
  }

  /** Applies new detection settings immediately, without touching the stream. */
  updateSettings(settings: VadSettings) {
    this.vad?.setOptions(toMicVadOptions(settings));
  }

  async start() {
    this.listening = true;
    await this.vad?.start();
  }

  /** Pausing submits any speech in progress as a clip. */
  async pause() {
    this.listening = false;
    this.clearSplitTimer();
    await this.vad?.pause();
    this.callbacks.onLevel?.(0);
  }

  async destroy() {
    this.listening = false;
    this.clearSplitTimer();
    try {
      await this.vad?.destroy();
    } catch {
      // already torn down
    }
    this.vad = null;
    this.callbacks.onLevel?.(0);
  }

  private now() {
    return performance.now() - this.t0;
  }

  private handleSpeechStart() {
    this.speechStartedAt = this.now();
    this.callbacks.onSpeaking?.(true);
    this.clearSplitTimer();
    this.splitTimer = setTimeout(() => void this.forceSplit(), MAX_UTTERANCE_MS);
  }

  private handleSpeechStop() {
    this.clearSplitTimer();
    this.speechStartedAt = null;
    this.callbacks.onSpeaking?.(false);
  }

  private handleSpeechEnd(audio: Float32Array) {
    const durationMs = samplesToMs(audio.length);
    const startedAt = this.speechStartedAt ?? Math.max(0, this.now() - durationMs);
    this.handleSpeechStop();
    this.callbacks.onClip({ audio, startedAt, durationMs });
  }

  /** Long monologue: submit what we have and keep listening. */
  private async forceSplit() {
    const vad = this.vad;
    if (!vad) return;
    try {
      await vad.pause(); // submitUserSpeechOnPause → onSpeechEnd with the audio so far
      // Paused or destroyed (Stop, leaving the page) meanwhile: don't bring it back.
      if (this.vad !== vad || !this.listening) return;
      await vad.start();
    } catch (err) {
      console.error('[recorder] force-split failed', err);
    }
  }

  private clearSplitTimer() {
    if (this.splitTimer) clearTimeout(this.splitTimer);
    this.splitTimer = null;
  }
}
