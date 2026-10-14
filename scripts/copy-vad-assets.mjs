#!/usr/bin/env node
// Copies the Silero VAD model, its AudioWorklet and the onnxruntime-web WASM files into
// public/vad so the browser can load them from our own origin. Runs on postinstall.
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Both are direct dependencies, so pnpm links them at the top of node_modules.
const vadDir = join(process.cwd(), 'node_modules', '@ricky0123', 'vad-web', 'dist');
const ortDir = join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist');
const out = join(process.cwd(), 'public', 'vad');

const files = [
  [vadDir, 'vad.worklet.bundle.min.js'],
  [vadDir, 'silero_vad_v5.onnx'],
  [ortDir, 'ort-wasm-simd-threaded.mjs'],
  [ortDir, 'ort-wasm-simd-threaded.wasm'],
];

await mkdir(out, { recursive: true });
for (const [dir, name] of files) await copyFile(join(dir, name), join(out, name));
console.log(`copied ${files.length} VAD assets to public/vad`);
