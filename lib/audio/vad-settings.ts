import { readJson, writeJson } from '@/lib/browser/storage';

/**
 * User-tunable speech detection, remembered on this device. The sliders map to MicVAD options
 * and are applied live (MicVAD.setOptions), so tuning never restarts the microphone.
 */
export interface VadSettings {
  /** Silence (ms) before a line is considered finished. Lower = choppier, higher = more lag. */
  redemptionMs: number;
  /** Silero speech probability needed to start a line. Lower = picks up quieter speech. */
  speechThreshold: number;
  /** Speech shorter than this (ms) is ignored as a cough or click. */
  minSpeechMs: number;
  /** Transcribe two lines again as one when a pause seems to have cut a word in two. */
  rejoin: boolean;
}

type SliderSetting = Exclude<keyof VadSettings, 'rejoin'>;

export const DEFAULT_VAD_SETTINGS: VadSettings = {
  redemptionMs: 600, // Korean speakers pause mid-sentence
  speechThreshold: 0.5,
  minSpeechMs: 400, // "네." still passes
  rejoin: true,
};

export const VAD_LIMITS = {
  redemptionMs: { min: 300, max: 1200, step: 100 },
  speechThreshold: { min: 0.3, max: 0.8, step: 0.05 },
  minSpeechMs: { min: 200, max: 800, step: 50 },
} as const satisfies Record<SliderSetting, { min: number; max: number; step: number }>;

/** Not user-facing: keeps the first syllable of each line. */
export const PRE_SPEECH_PAD_MS = 300;

/** Silero's authors keep the "speech ended" threshold 0.15 below the start threshold. */
const NEGATIVE_GAP = 0.15;

const KEY = 'nunchi.vadSettings';

function clampStep(value: unknown, { min, max, step }: { min: number; max: number; step: number }) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : NaN;
  if (Number.isNaN(n)) return null;
  const snapped = Math.round((n - min) / step) * step + min;
  // Round away float noise from the step arithmetic (0.35000000000000003).
  return Math.min(max, Math.max(min, Number(snapped.toFixed(4))));
}

/** Coerces anything (old or hand-edited storage) into valid settings. */
export function normalizeVadSettings(raw: unknown): VadSettings {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_VAD_SETTINGS };
  for (const key of Object.keys(VAD_LIMITS) as SliderSetting[]) {
    const v = clampStep(obj[key], VAD_LIMITS[key]);
    if (v !== null) out[key] = v;
  }
  if (typeof obj.rejoin === 'boolean') out.rejoin = obj.rejoin;
  return out;
}

export function loadVadSettings(): VadSettings {
  return readJson(KEY, normalizeVadSettings);
}

export function saveVadSettings(settings: VadSettings) {
  writeJson(KEY, normalizeVadSettings(settings));
}

/** The MicVAD (vad-web 0.0.31) frame-processor options for these settings. */
export function toMicVadOptions(s: VadSettings) {
  return {
    positiveSpeechThreshold: s.speechThreshold,
    negativeSpeechThreshold: Math.max(0.05, Number((s.speechThreshold - NEGATIVE_GAP).toFixed(2))),
    redemptionMs: s.redemptionMs,
    preSpeechPadMs: PRE_SPEECH_PAD_MS,
    minSpeechMs: s.minSpeechMs,
  };
}
