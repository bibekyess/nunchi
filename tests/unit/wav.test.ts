import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeWav, encodeWav, frameLevel, samplesToMs, WavError } from '@/lib/audio/wav';

describe('encodeWav', () => {
  it('writes a valid 16 kHz mono 16-bit PCM header', async () => {
    const samples = new Float32Array([0, 1, -1, 0.5, 2, -2]);
    const blob = encodeWav(samples);
    const view = new DataView(await blob.arrayBuffer());
    const ascii = (o: number) => String.fromCharCode(...new Uint8Array(view.buffer, o, 4));

    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + samples.length * 2);
    expect(ascii(0)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2);
    expect(ascii(8)).toBe('WAVE');
    expect(ascii(12)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(32000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(samples.length * 2);

    const pcm = Array.from({ length: samples.length }, (_, i) => view.getInt16(44 + i * 2, true));
    expect(pcm).toEqual([0, 32767, -32768, 16383, 32767, -32768]); // clipped at ±1
  });

  it('converts sample counts and levels', () => {
    expect(samplesToMs(16000)).toBe(1000);
    expect(frameLevel(new Float32Array(512))).toBe(0);
    expect(frameLevel(new Float32Array(512).fill(1))).toBe(1);
  });
});

describe('decodeWav', () => {
  const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

  it('is the exact inverse of encodeWav, for every 16-bit value', async () => {
    const pcm = new Int16Array(65536);
    for (let i = 0; i < pcm.length; i++) pcm[i] = i - 32768;
    const wav = new Uint8Array(44 + pcm.byteLength);
    wav.set(await bytes(encodeWav(new Float32Array(0))));
    new DataView(wav.buffer).setUint32(4, 36 + pcm.byteLength, true);
    new DataView(wav.buffer).setUint32(40, pcm.byteLength, true);
    wav.set(new Uint8Array(pcm.buffer), 44);

    const again = await bytes(encodeWav(decodeWav(wav.buffer)));
    expect(again).toEqual(wav);
  });

  it('reads the recorded fixtures, extra chunks included', () => {
    for (const name of ['ko-sample.wav', 'speech-en.wav']) {
      const file = readFileSync(`tests/fixtures/${name}`);
      const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
      expect(decodeWav(buffer).length).toBeGreaterThan(16000);
    }
  });

  it('rejects anything that is not 16 kHz mono 16-bit PCM', async () => {
    const header = async (patch: (v: DataView) => void) => {
      const buf = (await encodeWav(new Float32Array(8)).arrayBuffer()).slice(0);
      patch(new DataView(buf));
      return buf;
    };
    expect(() => decodeWav(new TextEncoder().encode('hello world!!').buffer)).toThrow(WavError);
    expect(() => decodeWav(new ArrayBuffer(3200))).toThrow(WavError);
    const stereo = await header((v) => v.setUint16(22, 2, true));
    expect(() => decodeWav(stereo)).toThrow('16-bit PCM mono');
    const rate = await header((v) => v.setUint32(24, 44100, true));
    expect(() => decodeWav(rate)).toThrow('16000 Hz');
    const float = await header((v) => v.setUint16(20, 3, true));
    expect(() => decodeWav(float)).toThrow(WavError);
    const noData = (await encodeWav(new Float32Array(0)).arrayBuffer()).slice(0, 36);
    expect(() => decodeWav(noData)).toThrow('no audio data');
  });
});
