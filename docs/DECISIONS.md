# Decisions

Changes to, or details not covered by, the implementation plan. Newest first.

## 2026-10-13 — Phase 1

- **We own the mic stream, not MicVAD.** `getStream`/`pauseStream`/`resumeStream` hand MicVAD a
  stream we opened, and pausing never stops its tracks, so resuming and the 25 s force-split
  (`pause()` + `start()` with `submitUserSpeechOnPause`) never re-prompt for permission. Stop and
  device changes do stop the tracks.
- **VAD option names in vad-web 0.0.31 are in ms** (`redemptionMs`, `preSpeechPadMs`,
  `minSpeechMs`), matching the plan's values directly. Model `v5` (512-sample frames).
- **ONNX runtime runs single-threaded** (`numThreads = 1`): multi-threaded WASM needs cross-origin
  isolation headers, and one thread is plenty for VAD.
- **Some Phase 2 items landed early because the queue needed them anyway:** the hallucination
  filter (with tests), 5-line rolling translation context, and glossary + last sentence in the
  Whisper prompt. Phase 2 still owns tuning and the settings slider.
- **"Untranslated" retry is client-side**: when the result is empty or equals the source, the
  queue asks once more with `retry: true`, and the server answers at temperature 0.
- **Interruption detection:** a mic track `ended` event, or no audio frames within 1.5 s of the
  page becoming visible again, restarts the recorder and shows a banner.
- **Clips waiting for the network are capped at 50**; the oldest is dropped (shown as an error)
  beyond that.
- **Passcode:** a 401 from any route shows an inline passcode field; the code is kept in
  `localStorage` and sent as `x-nunchi-token`.
- **No shadcn yet:** a few local primitives (`components/ui.tsx`: buttons, native `<dialog>`) and a
  native `<select>` for the language menu, which is also the best picker on phones.
- **`next start` with `output: 'standalone'`** prints a warning but works; the e2e test uses it.
  The Docker image (later) will run `.next/standalone/server.js`.

## 2026-10-13 — Phase 0

- **Next.js 16.4 with Cache Components** (the current `create-next-app` default). Route handlers
  run on Node by default, so no `runtime` export. `/api/health` calls `connection()` so it is
  never prerendered at build time. Env is validated lazily on first use, so `next build` works
  without secrets.
- **Library versions newer than the plan assumed:** zod 4 (`z.url()`), openai SDK 7, MSW 3
  (`onUnhandledFrame` replaces `onUnhandledRequest`), Vitest 5.
- **Speaches is called with `fetch` + `FormData`**, not the OpenAI SDK, to keep the
  `verbose_json` segment fields (`no_speech_prob`, `avg_logprob`) without casts. Whisper's language
  may come back as a code or a name (`korean`); both are normalized.
- **Unsupported-language fallback is server-side** in `/api/transcribe` (auto mode only): one
  re-transcription with `language=ko`, saving a client round trip.
- **Empty-translation retry is server-side**; the "identical to input" retry needs the full
  text and moves to the client queue in Phase 1.
- **OpenAI SDK `maxRetries: 0`** — the client job queue owns retries (Phase 1).
- **Languages come from `lib/languages.ts`** (`SUPPORTED_LANGS`), per the Oct 13 review, so a third
  language is one entry plus prompt testing.
- **Mock upstreams** (`scripts/mock-upstreams.mjs`) instead of real servers: this build
  environment cannot reach the GPU hosts. The mock enforces the custom LLM header and emits a
  split `<think>` block to exercise the stripper.
- **shadcn/ui not initialized yet**: its registry (ui.shadcn.com) is blocked from the build
  environment. Phase 0 uses plain Tailwind; run `pnpm dlx shadcn@latest init` where the registry
  is reachable before Phase 1 UI work.
