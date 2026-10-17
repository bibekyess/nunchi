# Decisions

Changes to, or details not covered by, the implementation plan. Newest first.

## 2026-10-17 — Engines Phase 1

Each task (speech to text, translation, summary) now runs on an engine chosen per device. Only
the server engine exists; with the default choice (all server) the app behaves as before, and
`pnpm smoke` against `pnpm mock` matches the Phase 0 output.

- **Engines** (`lib/engines/types.ts`): `SpeechEngine`, `TranslateEngine`, `SummaryEngine`, each
  with `id`, `needsNetwork` and `status()` (`ready` / `not_configured` / `unavailable` /
  `error`, with `needsPasscode` for a missing passcode). The server engine
  (`lib/engines/server.ts`, formerly `lib/api-client.ts`) encodes WAV itself, and its three
  engines share one `/api/health` request (2 s cache, a failed check is not reused).
- **Choice** (`lib/settings/engines.ts`): `{ speech, translate, summary }` under
  `nunchi.engines`, validated per task with zod (bad values fall back to `server`), in a small
  zustand store that follows other tabs through the `storage` event. `useEngineChoice()`
  renders the default until hydration so server and client HTML match. Endpoint settings are
  not stored yet; Phase 2 adds them.
- **No silent fallback:** a choice of an engine that isn't built yet (`endpoint`, `device`)
  gets a stand-in engine whose calls fail with an `unavailable` error that isn't retried.
  Work never goes to the server instead, since someone who picked on-device processing may not
  want their audio sent anywhere.
- **The queue reads `getEngines()` for each line** (`QueueDeps.engines`), so a switch applies
  from the next line, and waits for the network only when that line's engine needs it.
  Summaries use the summary engine. `EngineError.engine` records which engine failed; only a
  server `auth` error opens the passcode banner (`needsPasscode`).
- **Optional upstreams:** `SPEACHES_BASE_URL` and `LLM_BASE_URL` + `LLM_MODEL` (set together)
  may be empty. Routes for an unset service answer `503 not_configured` after the passcode
  check, `/api/health` reports `not_configured` without pinging, and the client maps it to an
  `unavailable` error that isn't retried.
- **Processing dialog** (session ⋯ menu and a button in the home header): Server / Custom /
  This device per task with a live status badge. Custom and This device are disabled with
  "Coming soon"; Server is disabled for a task the server isn't set up for. Saved with Save,
  like Audio. `SegmentedControl` options can be disabled (skipped by arrow keys, and the tab
  stop moves to the first selectable option).
- **Health label:** "Servers ready" when every task is on the server and ready; otherwise only
  the tasks that need attention (e.g. "Speech not set up"), truncated on narrow phones, with
  each task's engine and status in the tooltip. Warn tone for not set up / coming soon. The
  offline banner only shows while a chosen engine needs the network.
- **`Session.engines`** records the choice when listening starts or resumes, for later quality
  comparisons. It isn't indexed, so the Dexie schema stays at version 1.
- **Aborted transcriptions** are logged as `aborted` with an empty 499, like translate and
  summarize, instead of `speaches upstream_error … ResponseAborted`.

## 2026-10-17 — Engines Phase 0

Cleanup before switchable engines (see `docs/ENGINES-PLAN.md`). No behavior change: API
shapes, prompts, temperatures, timeouts, retries, log lines and storage keys are the same, and
`pnpm smoke` plus extra route probes against `pnpm mock` matched the output from before.

- **`lib/core/` holds the pipeline logic** that used to live in the route handlers:
  `translate.ts` (prompt, `<think>` removal, one non-streamed retry on empty output),
  `summarize.ts` (line formatting, parts two at a time, streamed merge) and `transcribe.ts`
  (one Korean retry when auto-detect lands outside the supported set). It depends only on
  `ChatModel` and `SpeechModel` from `lib/core/models.ts` and uses no Node- or DOM-only APIs,
  so the browser can run it later with endpoint or on-device models.
- **Server models:** `serverChat` (`lib/server/llm.ts`, OpenAI SDK, vLLM no-thinking flag) and
  `serverSpeech` (`lib/server/speaches.ts`). A `start*` function opens the upstream stream
  before the route answers, so connection errors still become JSON errors; timing stays in
  the routes (`onPartsDone` reports summary parts).
- **Routes are thin:** access check, `parseJsonBody`, core call, `streamText` (one place for
  the plain-text stream, timing line and mid-stream errors). Request schemas shared in
  `lib/schemas.ts`.
- **Errors:** `EngineError { kind, retryable }` in `lib/errors.ts`; `ApiError` extends it with
  the same retry rule (network, 408, 429, 5xx). The queue and summary check the kind, not the
  HTTP client. The access-token header name lives there too, shared by client and server.
- **The queue hands raw samples to `transcribe`.** WAV encoding moved into the server adapter in
  `session-controller.ts`; on-device engines will take the `Float32Array` as is.
- **Smaller pieces:** one glossary formatter (`lib/prompts/glossary.ts`), one `Semaphore` /
  `mapLimit` (`lib/util/concurrency.ts`), guarded localStorage helpers (`lib/storage.ts`;
  zustand `persist` and the inline theme script keep their own), summary generation in a
  `useSummary` hook (`lib/use-summary.ts`), and `components/ui.tsx` split into
  `components/ui/` with an `index.ts`, so `../ui` imports are unchanged.

## 2026-10-13 — Phase 3

- **Scope cut to what helps follow a meeting:** on-device sessions, the recent list and the
  summary. Search, Markdown export, Copy all and the PWA manifest were dropped; Phases 4–5
  (speaker labels, share links, server persistence) are not planned. No database server:
  everything lives in the browser's IndexedDB.
- **Saving:** a store subscriber (`lib/db/persist.ts`) writes changed utterances. Settled
  ones (done / skipped / error) are written within the same tick; streaming translation
  updates are batched every second; `pagehide` flushes the rest. A session is first written
  with its first utterance, so opening and leaving an empty session leaves nothing behind.
  If IndexedDB is unavailable (some private windows) the session still works, unsaved.
- **Crash recovery:** on load, utterances still `transcribing` become errors without retry
  (audio is never stored); `translating` ones become errors that retry from the saved source
  text. The queue is created after loading, so new lines continue the saved `seq`.
- **Listening time is saved as `Session.durationMs`** (pauses excluded) and restores the
  header timer; `endedAt` is set when recording stops.
- **Summary language** defaults to the session's target language and is remembered as
  `Session.summaryLang`. Long transcripts: parts of ≤ 24k characters are summarized without
  streaming (two at a time, 800 tokens each), then a merge prompt is streamed. LLM calls
  for summaries get a 3-minute timeout instead of the client's 60 s.
- **Markdown rendering:** `react-markdown` + `remark-gfm` (`singleTilde: false`) inside
  Tailwind Typography `prose` classes, so action items render as task-list checkboxes.
- **Transcript and Summary tabs stay mounted** (hidden, not unmounted), so the transcript keeps
  its scroll position and a summary keeps streaming while the other tab is open.

## 2026-10-13 — Phase 2

- **The view filter is by language, not by role** (matches Cuckoo's "All languages" menu):
  All languages / 한국어 / English. Picking English shows English speakers' originals and Korean
  speakers' translations, so it reads as one English transcript; the plan's Both / Original /
  Translation was dropped. With one language picked, every visible line uses the large style.
  Translation still runs for hidden lines (export and summary need both).
- **Side-by-side means one column per language** (한국어 left, English right) rather than
  original | translation, so each column stays one language when speakers alternate. Only with
  "All languages" and at ≥ 768 px; narrower screens stack.
- **Toolbar follows the Cuckoo screenshot:** filter pill + layout toggle on the left; translation
  direction (now a round icon over a native select) and text size (one tap: S → M → L) on the
  right, leaving room for Phase 3 search and Phase 4 ✨. Glossary and Audio settings moved
  to the header ⋯ menu that the plan described. Flags are inline SVG, because flag emoji don't
  render on Windows.
- **Display preferences** live in a separate Zustand store with `persist` (`nunchi.display`),
  not in the session: they are per device and will also drive the Phase 5 viewer.
- **Speech detection settings apply live** through vad-web's `MicVAD.setOptions`, with no restart.
  The dialog's Cancel button undoes them. Sensitivity sets `positiveSpeechThreshold` 0.3–0.8 with
  `negativeSpeechThreshold` 0.15 below (Silero's convention). Pre-speech pad stays fixed at 300 ms
  and the 25 s force-split is unchanged.
- **Tab audio:** `getDisplayMedia({ video: true, audio })` (Chrome won't offer audio without
  video). The video track is stopped at once, and tab audio is captured with echo cancellation, noise
  suppression and AGC off. "Tab + microphone" mixes both through a `MediaStreamDestination`.
  It is offered only where `navigator.userAgentData` exists and is not mobile, which means desktop Chromium.
  Safari and Firefox implement `getDisplayMedia` without audio. Whole-system audio needs an
  entire-screen share and only works on Windows / ChromeOS.
- **"Stop sharing" pauses instead of restarting**: re-sharing needs a new picker and a user
  gesture, so a banner offers "Share again". Closing the picker without sharing is not an error.
- **`PLAN.md` is in `.prettierignore`**: it's the user's working copy of the plan and must not
  be reformatted.

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
