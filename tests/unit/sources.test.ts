import { describe, expect, it } from 'vitest';
import { canCaptureTabAudio } from '@/lib/audio/sources';

const nav = (opts: { display?: boolean; uaData?: { mobile: boolean } }) =>
  ({
    mediaDevices: opts.display ? { getDisplayMedia: () => {} } : {},
    ...(opts.uaData ? { userAgentData: opts.uaData } : {}),
  }) as unknown as Navigator;

describe('canCaptureTabAudio', () => {
  it('allows desktop Chromium', () => {
    expect(canCaptureTabAudio(nav({ display: true, uaData: { mobile: false } }))).toBe(true);
  });

  it('hides on mobile Chromium', () => {
    expect(canCaptureTabAudio(nav({ display: true, uaData: { mobile: true } }))).toBe(false);
  });

  it('hides on Safari and Firefox (getDisplayMedia without audio)', () => {
    expect(canCaptureTabAudio(nav({ display: true }))).toBe(false);
  });

  it('hides when screen capture is missing', () => {
    expect(canCaptureTabAudio(nav({ uaData: { mobile: false } }))).toBe(false);
    expect(canCaptureTabAudio(undefined)).toBe(false);
  });
});
