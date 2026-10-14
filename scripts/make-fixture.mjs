#!/usr/bin/env node
// Writes a 2 s, 16 kHz, 16-bit mono WAV tone used as a stand-in audio fixture.
// Replace tests/fixtures/ko-sample.wav with a real Korean recording for real-backend runs.
import { writeFile } from 'node:fs/promises';

const rate = 16000;
const seconds = 2;
const samples = rate * seconds;
const buf = Buffer.alloc(44 + samples * 2);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + samples * 2, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); // PCM
buf.writeUInt16LE(1, 22); // mono
buf.writeUInt32LE(rate, 24);
buf.writeUInt32LE(rate * 2, 28);
buf.writeUInt16LE(2, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) {
  const v = Math.sin((2 * Math.PI * 220 * i) / rate) * 0.2;
  buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
}
const out = process.argv[2] ?? 'tests/fixtures/ko-sample.wav';
await writeFile(out, buf);
console.log(`wrote ${out} (${buf.length} bytes)`);
