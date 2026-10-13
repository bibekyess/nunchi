# Decisions

Changes to, or details not covered by, the implementation plan. Newest first.

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
