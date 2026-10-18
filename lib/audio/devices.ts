import { readString as read, writeString as write } from '@/lib/browser/storage';

const DEVICE_KEY = 'nunchi.inputDeviceId';
const NOISE_KEY = 'nunchi.noiseSuppression';

export const savedDeviceId = () => read(DEVICE_KEY) ?? undefined;
export const saveDeviceId = (id: string | undefined) => write(DEVICE_KEY, id ?? null);
export const savedNoiseSuppression = () => read(NOISE_KEY) !== 'off';
export const saveNoiseSuppression = (on: boolean) => write(NOISE_KEY, on ? 'on' : 'off');

export interface InputDevice {
  deviceId: string;
  label: string;
}

/** Audio inputs. Labels are only filled in after mic permission has been granted once. */
export async function listInputDevices(): Promise<InputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput' && d.deviceId !== '')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}

export type MicErrorKind =
  | 'denied'
  | 'no-device'
  | 'insecure'
  | 'unsupported'
  | 'cancelled' // the user closed the tab-share picker
  | 'no-tab-audio' // a tab was shared without its audio
  | 'other';

export class MicError extends Error {
  constructor(
    public readonly kind: MicErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'MicError';
  }
}

export async function openMicrophone(opts: {
  deviceId?: string;
  noiseSuppression: boolean;
}): Promise<MediaStream> {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    throw new MicError('insecure', 'The microphone needs HTTPS (or localhost).');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new MicError('unsupported', 'This browser cannot record audio.');
  }
  const audio: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: opts.noiseSuppression,
    autoGainControl: true,
  };
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: opts.deviceId ? { ...audio, deviceId: { exact: opts.deviceId } } : audio,
    });
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (name === 'OverconstrainedError' && opts.deviceId) {
      // The remembered device is gone (unplugged); fall back to the default mic.
      saveDeviceId(undefined);
      return openMicrophone({ ...opts, deviceId: undefined });
    }
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new MicError('denied', 'Microphone access was blocked.');
    }
    if (name === 'NotFoundError' || name === 'NotReadableError') {
      throw new MicError('no-device', 'No working microphone was found.');
    }
    throw new MicError('other', err instanceof Error ? err.message : String(err));
  }
}
