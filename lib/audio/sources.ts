import { readString, writeString } from '@/lib/browser/storage';
import { MicError, openMicrophone } from './devices';

/** Where speech comes from: the room (mic), a browser tab / the system, or both mixed. */
export type AudioSource = 'mic' | 'tab' | 'mix';

const SOURCE_KEY = 'nunchi.audioSource';

export function savedAudioSource(): AudioSource {
  const v = readString(SOURCE_KEY);
  if (v === 'tab' || v === 'mix') return canCaptureTabAudio() ? v : 'mic';
  return 'mic';
}

export function saveAudioSource(source: AudioSource) {
  writeString(SOURCE_KEY, source);
}

interface UADataLike {
  mobile?: boolean;
}

/**
 * Tab/system audio capture works in desktop Chromium only: Safari and Firefox implement
 * getDisplayMedia without audio, and mobile browsers have no screen capture at all.
 * `navigator.userAgentData` exists only in Chromium, so it doubles as the engine check.
 */
export function canCaptureTabAudio(nav: Navigator | undefined = globalThis.navigator): boolean {
  if (!nav?.mediaDevices || typeof nav.mediaDevices.getDisplayMedia !== 'function') return false;
  const uaData = (nav as Navigator & { userAgentData?: UADataLike }).userAgentData;
  if (!uaData) return false;
  return uaData.mobile !== true;
}

/** An open audio input. `stream` is what the VAD listens to. */
export interface AudioInput {
  source: AudioSource;
  stream: MediaStream;
  /** Microphone tracks (empty for tab-only). The OS can take these away (calls, lock screen). */
  micTracks: MediaStreamTrack[];
  /** Shared-tab audio tracks (empty for mic-only). They end when the user stops sharing. */
  tabTracks: MediaStreamTrack[];
  dispose: () => void;
}

const isLive = (t: MediaStreamTrack) => t.readyState === 'live';

export const micEnded = (input: AudioInput) =>
  input.micTracks.length > 0 && !input.micTracks.some(isLive);
export const tabEnded = (input: AudioInput) =>
  input.tabTracks.length > 0 && !input.tabTracks.some(isLive);

/**
 * Asks the user to share a tab (or screen) with audio. Chrome only offers audio when video is
 * requested too, so the video track is stopped as soon as the share starts.
 */
export async function openTabAudio(): Promise<MediaStream> {
  if (!canCaptureTabAudio()) {
    throw new MicError('unsupported', 'This browser cannot capture tab audio.');
  }
  // Chrome-only hints, not yet in TypeScript's DOM types: offer system audio when a whole screen
  // is shared, and leave nunchi's own tab out of the picker.
  const options: DisplayMediaStreamOptions & Record<string, unknown> = {
    video: true,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    systemAudio: 'include',
    selfBrowserSurface: 'exclude',
  };
  let display: MediaStream;
  try {
    display = await navigator.mediaDevices.getDisplayMedia(options);
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (name === 'NotAllowedError' || name === 'AbortError') {
      throw new MicError('cancelled', 'Sharing was cancelled.');
    }
    throw new MicError('other', err instanceof Error ? err.message : String(err));
  }
  display.getVideoTracks().forEach((t) => t.stop());
  const audio = display.getAudioTracks();
  if (audio.length === 0) {
    throw new MicError('no-tab-audio', 'The shared tab has no audio.');
  }
  return new MediaStream(audio);
}

/** Mixes several streams into one; the VAD downmixes it to 16 kHz mono itself. */
function mixStreams(streams: MediaStream[]): { stream: MediaStream; close: () => void } {
  const ctx = new AudioContext();
  const out = ctx.createMediaStreamDestination();
  for (const s of streams) ctx.createMediaStreamSource(s).connect(out);
  void ctx.resume();
  return { stream: out.stream, close: () => void ctx.close().catch(() => {}) };
}

export async function openAudioInput(
  source: AudioSource,
  mic: { deviceId?: string; noiseSuppression: boolean },
): Promise<AudioInput> {
  if (source === 'mic') {
    const stream = await openMicrophone(mic);
    return {
      source,
      stream,
      micTracks: stream.getAudioTracks(),
      tabTracks: [],
      dispose: () => stream.getTracks().forEach((t) => t.stop()),
    };
  }

  // Share first: the tab picker must open while the tap still counts as a user gesture.
  const tab = await openTabAudio();
  if (source === 'tab') {
    return {
      source,
      stream: tab,
      micTracks: [],
      tabTracks: tab.getAudioTracks(),
      dispose: () => tab.getTracks().forEach((t) => t.stop()),
    };
  }

  let micStream: MediaStream;
  try {
    micStream = await openMicrophone(mic);
  } catch (err) {
    tab.getTracks().forEach((t) => t.stop());
    throw err;
  }
  const mixed = mixStreams([micStream, tab]);
  return {
    source,
    stream: mixed.stream,
    micTracks: micStream.getAudioTracks(),
    tabTracks: tab.getAudioTracks(),
    dispose: () => {
      for (const s of [mixed.stream, micStream, tab]) s.getTracks().forEach((t) => t.stop());
      mixed.close();
    },
  };
}
