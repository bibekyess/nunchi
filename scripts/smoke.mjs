#!/usr/bin/env node
// End-to-end check of the API routes: transcribe a WAV, then stream its translation.
// Usage: pnpm smoke [path/to/clip.wav]
// Env:   SMOKE_BASE_URL (default http://localhost:3000), APP_ACCESS_TOKEN (if the app requires it)

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const base = (process.env.SMOKE_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const file = process.argv[2] ?? 'tests/fixtures/ko-sample.wav';
const headers = process.env.APP_ACCESS_TOKEN
  ? { 'x-nunchi-token': process.env.APP_ACCESS_TOKEN }
  : {};

function fail(step, detail) {
  console.error(`✗ ${step}: ${detail}`);
  process.exit(1);
}

const health = await fetch(`${base}/api/health`, { headers }).catch((e) =>
  fail('health', e.message),
);
console.log('health:', health.status, await health.text());

const audio = await readFile(file).catch((e) => fail('read fixture', e.message));
const form = new FormData();
form.append('audio', new Blob([audio], { type: 'audio/wav' }), basename(file));
form.append('language', 'auto');

let t0 = performance.now();
const tr = await fetch(`${base}/api/transcribe`, { method: 'POST', body: form, headers });
const transcript = await tr.json();
if (!tr.ok) fail('transcribe', JSON.stringify(transcript));
console.log(`\ntranscribe (${Math.round(performance.now() - t0)} ms):`);
console.log(`  [${transcript.language}] ${transcript.text}`);
if (!transcript.text) fail('transcribe', 'empty text');

const sourceLang = transcript.language === 'en' ? 'en' : 'ko';
const targetLang = sourceLang === 'ko' ? 'en' : 'ko';

t0 = performance.now();
const res = await fetch(`${base}/api/translate`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: transcript.text,
    sourceLang,
    targetLang,
    context: [],
    glossary: [],
  }),
});
if (!res.ok || !res.body) fail('translate', `${res.status} ${await res.text()}`);

process.stdout.write(`\ntranslate → ${targetLang}:\n  `);
let firstByte;
let translation = '';
const decoder = new TextDecoder();
for await (const chunk of res.body) {
  firstByte ??= performance.now() - t0;
  const text = decoder.decode(chunk, { stream: true });
  translation += text;
  process.stdout.write(text);
}
console.log(
  `\n  (first token ${Math.round(firstByte ?? 0)} ms, total ${Math.round(performance.now() - t0)} ms)`,
);
if (!translation.trim()) fail('translate', 'empty translation');
if (translation.includes('<think>')) fail('translate', 'think block leaked into output');
console.log('\n✓ smoke passed');
