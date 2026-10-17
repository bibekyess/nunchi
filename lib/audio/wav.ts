export const SAMPLE_RATE = 16_000;

/** Encodes mono Float32 samples (-1..1) as a 16-bit PCM WAV. 10 s at 16 kHz ≈ 320 KB. */
export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Blob {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** An upload that isn't the 16 kHz mono 16-bit PCM WAV the app records. */
export class WavError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WavError';
  }
}

/**
 * The middle of the range `encodeWav` truncates to `v`. Plain `v / 32767` doesn't survive
 * float32 storage: about half the values would come back one step lower when re-encoded.
 */
function fromInt16(v: number): number {
  if (v === 0) return 0;
  return v < 0 ? (v - 0.5) / 0x8000 : (v + 0.5) / 0x7fff;
}

/**
 * Decodes a 16-bit PCM mono WAV at `sampleRate` (what `encodeWav` writes) to Float32 samples.
 * Walks the chunks, so extra ones (e.g. LIST) are fine. Anything else throws a `WavError`.
 * Exact inverse of `encodeWav`: encoding the result gives back the same bytes.
 */
export function decodeWav(buffer: ArrayBuffer, sampleRate = SAMPLE_RATE): Float32Array {
  const view = new DataView(buffer);
  const ascii = (offset: number) => String.fromCharCode(...new Uint8Array(buffer, offset, 4));
  if (buffer.byteLength < 12 || ascii(0) !== 'RIFF' || ascii(8) !== 'WAVE') {
    throw new WavError('Not a WAV file.');
  }
  let format = false;
  for (let offset = 12; offset + 8 <= buffer.byteLength;) {
    const id = ascii(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > buffer.byteLength) throw new WavError('Broken WAV header.');
      const pcm = view.getUint16(body, true) === 1;
      const channels = view.getUint16(body + 2, true);
      const rate = view.getUint32(body + 4, true);
      const bits = view.getUint16(body + 14, true);
      if (!pcm || channels !== 1 || rate !== sampleRate || bits !== 16) {
        throw new WavError(`Expected 16-bit PCM mono audio at ${sampleRate} Hz.`);
      }
      format = true;
    } else if (id === 'data') {
      if (!format) throw new WavError('Broken WAV header.');
      // Some writers leave the size unset; read what is there.
      const count = Math.floor(Math.min(size, buffer.byteLength - body) / 2);
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i++) samples[i] = fromInt16(view.getInt16(body + i * 2, true));
      return samples;
    }
    offset = body + size + (size % 2); // chunks are padded to even sizes
  }
  throw new WavError('The WAV file has no audio data.');
}

export function samplesToMs(samples: number, sampleRate = SAMPLE_RATE): number {
  return Math.round((samples / sampleRate) * 1000);
}

/** RMS level of a frame mapped to 0..1 for a meter (roughly -60 dB..0 dB). */
export function frameLevel(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  const rms = Math.sqrt(sum / Math.max(1, frame.length));
  const db = 20 * Math.log10(rms || 1e-8);
  return Math.max(0, Math.min(1, (db + 60) / 60));
}
