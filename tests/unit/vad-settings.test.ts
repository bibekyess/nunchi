import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VAD_SETTINGS,
  normalizeVadSettings,
  toMicVadOptions,
} from '@/lib/audio/vad-settings';

describe('normalizeVadSettings', () => {
  it('falls back to defaults for missing or junk input', () => {
    expect(normalizeVadSettings(null)).toEqual(DEFAULT_VAD_SETTINGS);
    expect(normalizeVadSettings('nope')).toEqual(DEFAULT_VAD_SETTINGS);
    expect(normalizeVadSettings({ redemptionMs: 'x', speechThreshold: NaN })).toEqual(
      DEFAULT_VAD_SETTINGS,
    );
  });

  it('clamps to the slider ranges', () => {
    const s = normalizeVadSettings({ redemptionMs: 50, speechThreshold: 0.99, minSpeechMs: 5000 });
    expect(s).toEqual({ redemptionMs: 300, speechThreshold: 0.8, minSpeechMs: 800, rejoin: true });
  });

  it('snaps to the slider step without float noise', () => {
    const s = normalizeVadSettings({ redemptionMs: 649, speechThreshold: 0.351, minSpeechMs: 420 });
    expect(s).toEqual({ redemptionMs: 600, speechThreshold: 0.35, minSpeechMs: 400, rejoin: true });
  });

  it('keeps the rejoin switch only when it is a boolean', () => {
    expect(normalizeVadSettings({ rejoin: false }).rejoin).toBe(false);
    expect(normalizeVadSettings({ rejoin: 'no' }).rejoin).toBe(true);
  });
});

describe('toMicVadOptions', () => {
  it('keeps the plan defaults', () => {
    expect(toMicVadOptions(DEFAULT_VAD_SETTINGS)).toEqual({
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.35,
      redemptionMs: 600,
      preSpeechPadMs: 300,
      minSpeechMs: 400,
    });
  });

  it('keeps the end threshold 0.15 below the start threshold', () => {
    const o = toMicVadOptions({ ...DEFAULT_VAD_SETTINGS, speechThreshold: 0.3 });
    expect(o.negativeSpeechThreshold).toBe(0.15);
  });
});
