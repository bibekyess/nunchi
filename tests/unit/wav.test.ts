import { describe, expect, it } from 'vitest';
import { encodeWav, frameLevel, samplesToMs } from '@/lib/audio/wav';

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
