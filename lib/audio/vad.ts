import type { MicVAD } from '@ricky0123/vad-web';
import { frameLevel, samplesToMs } from './wav';

const ASSET_PATH = '/vad/';

/** Starting values from the plan; tuned in Phase 2. */
export const VAD_SETTINGS = {
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,
  preSpeechPadMs: 300,
  redemptionMs: 600, // Korean speakers pause mid-sentence; lower = choppier, higher = more lag
  minSpeechMs: 400, // ignore coughs/clicks; "네." still passes
};
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
 * Wraps MicVAD around a stream we own, so pausing never stops the tracks (no new permission
 * prompt on resume) and long monologues can be force-split.
 */
export class SpeechRecorder {
  private vad: MicVAD | null = null;
  private speechStartedAt: number | null = null;
  private splitTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly t0 = performance.now();

  private constructor(
    private readonly stream: MediaStream,
    private readonly callbacks: SpeechRecorderCallbacks,
  ) {}

  static async create(
    stream: MediaStream,
    callbacks: SpeechRecorderCallbacks,
  ): Promise<SpeechRecorder> {
    const recorder = new SpeechRecorder(stream, callbacks);
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
      ...VAD_SETTINGS,
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

  get mediaStream(): MediaStream {
    return this.stream;
  }

  /** True when the browser killed the mic (tab hidden, phone locked, device unplugged). */
  get streamEnded(): boolean {
    return this.stream.getAudioTracks().every((t) => t.readyState === 'ended');
  }

  async start() {
    await this.vad?.start();
  }

  /** Pausing submits any speech in progress as a clip. */
  async pause() {
    this.clearSplitTimer();
    await this.vad?.pause();
    this.callbacks.onLevel?.(0);
  }

  async destroy() {
    this.clearSplitTimer();
    try {
      await this.vad?.destroy();
    } catch {
      // already torn down
    }
    this.vad = null;
    this.stream.getTracks().forEach((t) => t.stop());
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
    if (!this.vad) return;
    await this.vad.pause(); // submitUserSpeechOnPause → onSpeechEnd with the audio so far
    await this.vad.start();
  }

  private clearSplitTimer() {
    if (this.splitTimer) clearTimeout(this.splitTimer);
    this.splitTimer = null;
  }
}
