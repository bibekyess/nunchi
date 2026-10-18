# Decisions

Changes to, or details not covered by, the implementation plan. Newest first.

## 2026-10-18 — lib layout and hook convention

`lib/` is grouped by what the code is for, so a file's folder says what it may depend on.
Pure moves and import rewrites; no behavior changed.

- **Root:** only `types.ts`, `errors.ts` and `languages.ts`, which nearly everything imports.
- **Folders:** `api/` (route contract and shared zod schemas), `core/` (portable pipeline
  logic, now including `think-stripper.ts`), `session/` (the controller, the session store and
  `use-summary.ts`), `display/` (display store, view helpers, formatting), `browser/`
  (localStorage helpers, wake lock, `waitForOnline`, theme and the inline theme script). `audio/`,
  `db/`, `engines/`, `pipeline/`, `prompts/`, `server/`, `settings/` and `util/` are unchanged;
  `lib/store/` is gone. `db/` stays separate from `session/`.
- **Hooks stay with their domain** as `use-*.ts` (`settings/use-engine-settings.ts`,
  `engines/use-engine-status.ts`, `session/use-summary.ts`); there is no `hooks/` folder. The
  portable-imports lint rule bans `@/lib/**/use-*` and the stores (`@/lib/session/*`,
  `@/lib/display/store`) from `lib/core`, `lib/util` and the pure settings.
- **No barrels:** imports name the file (`@/lib/session/store`), with no `index.ts` or
  re-export shims.

## 2026-10-17 — Hardening before Phase 3

An independent review of Phases 0–2 found long-running failure modes and a few structural
issues that Phase 3 (workers, device models) would have inherited. Each fix below has a test
that fails on the code before it. Server mode is unchanged otherwise: `pnpm smoke` against
`pnpm mock`, the route probes and the server's log lines (timings aside) match Phase 2.

- **Stalled streams time out.** `withIdleTimeout` (`lib/util/streams.ts`) wraps a stream and
  throws a retryable timeout when the next piece takes too long, stopping the upstream. Limits:
  OpenAI-compatible SSE streams allow the call's timeout for the first event (prompt
  processing), then 30 s between events (`DEFAULT_STREAM_IDLE_MS`); the server engine's
  streamed bodies 90 s (210 s for the summary's first piece); the server's `streamText` 90 s as
  a backstop (210 s for the summary's first piece). Every `/api/*` call from the browser also
  has an overall limit (`CALL_TIMEOUT_MS`: transcribe 90 s, translate 150 s, summary 20 min,
  health 10 s), built on `AbortSignal.any` so a cancel is still an AbortError. Before, a
  half-open connection held one of the queue's two slots for the rest of the session.
- **Leaving mid-start closes the mic.** `SessionController.start()` checks a `disposed` flag
  after every await and closes what it just opened; the queue ignores clips after dispose; the
  25 s force-split doesn't restart detection that was paused or destroyed meanwhile (this also
  ended an unhandled rejection).
- **Dropped clips are really dropped.** Each transcription job has its own AbortController,
  cancelled when the 50-clip cap evicts its clip. The audio is looked up when it is sent, so a
  waiting job doesn't hold it, and a dropped line keeps its "Dropped" error instead of being
  transcribed once back online. `waitForOnline` (`lib/browser/online.ts`) takes the job's signal
  and removes its listener when cancelled.
- **The speech model takes samples.** `SpeechModel.transcribe(audio: Float32Array)`; HTTP
  models encode the WAV. `/api/transcribe` decodes the upload with `decodeWav` (16 kHz mono
  16-bit PCM only; anything else is a 400) and Speaches gets it re-encoded byte for byte: the
  decoder returns the middle of each step `encodeWav` truncates to, since a plain `v / 32767`
  loses a step on about half the values once stored as float32. Chosen over keeping a Blob
  path so `transcribeWithFallback` is the same code for every engine, including Phase 3's
  Whisper worker. Speaches transcription uses the shared client; errors go through
  `toUpstreamError(err, 'speaches')`.
- **Semaphore:** a freed slot passes straight to the next waiter (FIFO). Before, a call
  arriving in between could take it and run alongside the waiter, over the limit.
- **One endpoint client** (`endpointClient(config, kind)`) for the engines and Test
  connection, and one exported `hostOf`.
- **One endpoint validator:** `endpointIssues()` returns `{ field, message }[]` for the dialog,
  the engines and saving. A custom header name with a space (or a name without a value) now
  blocks saving with a message, instead of being dropped on save and failing later with a 401.
  The dialog shows the first issue and marks every field that has one.
- **Settings split:** `lib/settings/engine-settings.ts` is pure (no React, stores or
  import-time listeners; plain `includes` instead of zod), so a worker can use it;
  `use-engine-settings.ts` has the zustand store, hooks and the cross-tab listener.
- **Layering:** engine and task names live in `lib/engines/ids.ts`, which imports nothing, so
  `lib/types`, `lib/errors` and `lib/core` no longer depend on the engines layer, and there are
  no import cycles. ESLint's `no-restricted-imports` keeps `lib/core`, `lib/util` and the pure
  settings free of React, Next, zustand, stores, settings hooks, server-only code, components
  and the engines (except `ids`).
- **Request limits:** bodies are read with a cap, refused from `Content-Length` before
  reading or as soon as a streamed body passes it: 2 MB + 64 KB for a clip, 1 MB for a
  translation, 2 MB for a summary. A summary's transcript is capped at 300,000 characters
  (`SUMMARY_MAX_CHARS`): a two-hour meeting is about 180,000, so this allows roughly three
  hours of dense talk, at most ~13 parts, instead of hundreds of LLM calls.
- **Config checked at boot:** `instrumentation.ts` validates the environment once when the
  server starts. An invalid one prints the usual "Invalid server environment" message and
  exits, since Next alone logs it and keeps serving 500s. A production server with upstreams
  but no `APP_ACCESS_TOKEN` logs a warning. Builds skip the check (`NEXT_PHASE`), so they still
  need no secrets.
- **429 from `/api/*`** is a retryable `upstream` error, as in the endpoint client (it was
  `bad_request` yet retryable).
- **Summary generation** moved from the `useSummary` hook into `generateSummary()`, which
  reports and saves nothing once its signal aborts, so a superseded request whose engine
  ignores the abort can't overwrite the newer summary.

Left for Phase 3, where they belong next to the device engines (see `ENGINES-PLAN.md`): an
engine factory table with `prepare`/`dispose`, a richer status with download progress and
`subscribe`, `needsNetwork` as a function, a GPU scheduler, device settings, and
`navigator.locks`. Skipped for now: storing the recent-list preview on the session and the
banner's per-update failed count; neither matters at today's sizes.

## 2026-10-17 — Engines Phase 2

**Custom** endpoints work: each task can run on an OpenAI-compatible server that the browser
calls directly. Server mode is unchanged: `pnpm smoke` against `pnpm mock`, a set of route
probes and the server's log lines (timings aside) match Phase 1.

- **One shared client** (`lib/core/openai-compatible.ts`): fetch only, so the browser and the
  server use the same code. `ChatModel` (streamed and plain `/chat/completions`), `SpeechModel`
  (`/audio/transcriptions`, `verbose_json`) and `listModels()`. A small SSE parser handles
  events split across chunks, CRLF/CR, comments and `[DONE]`; an `error` event mid-stream fails
  the stream. The timeout covers the wait for the response to start, as the OpenAI SDK did.
  Failures are `EndpointError` (an `EngineError`): `network` (fetch rejected without a status:
  DNS, refused, CORS and mixed content look the same to a page), `auth` (401/403), `timeout`,
  `upstream` (429, 5xx, a broken stream, non-JSON) or `bad_request`. The message is safe to
  show; the server's response body is kept apart as `detail` for logs.
- **The server's LLM uses it too; the `openai` package is gone.** Same behavior: vLLM's
  `chat_template_kwargs`, the custom header, `Bearer LLM_API_KEY` (or `none`), 60 s (180 s for
  summaries), no automatic retries, abort on disconnect, `pingLlm` via `GET /models`.
  `toUpstreamError` logs `detail`, so upstream bodies still reach the server log and never the
  client. The Speaches client reuses the shared transcription parser.
- **Settings** (`nunchi.engines`) become `{ choice, endpoints }`: one speech endpoint plus
  translation and summary configs (URL, model, API key, optional header, disable-thinking).
  The summary uses the translation endpoint unless "Same as translation" is off. The Phase 1
  flat choice loads as `choice`. Only http(s) URLs are kept (trailing slashes dropped); a
  header name must be a valid token, and line breaks are stripped from secrets. Keys stay in
  this browser's localStorage, next to the other per-device settings, with a note in the
  dialog saying so.
- **Endpoint engines** (`lib/engines/endpoint.ts`) run the same `lib/core` logic as the server
  routes (Korean fallback for unsupported detected languages, empty-answer retry, chunked
  summaries), WAV-encoding clips themselves. They never call `/api/*`. `needsNetwork` is false
  only for `localhost`, `127.0.0.1` and `[::1]`, so local servers keep working offline. An
  unfilled endpoint fails without retrying; a refused key says to check Processing settings and
  never opens the app passcode banner. Status is `GET /models` (5 s).
- **Processing dialog:** Custom opens a form per task: quick-fill presets (Speaches, Ollama,
  LM Studio), URL, model (suggestions from `/models`), API key (`type="password"`), and under
  More options a custom header and vLLM's disable-thinking switch. While translation is Custom,
  the summary offers "Same as translation" (on by default); otherwise the summary's form edits
  the endpoint it will use. Save is blocked, with the reason, while a chosen endpoint has no
  valid URL or model. Status badges follow the draft after typing pauses (0.7 s).
- **Test connection** (`lib/engines/endpoint-check.ts`): `/models`, then for chat a 1-token
  answer (60 s, as a local model may need to load). A failed request is told apart with a
  `no-cors` probe: if that gets through, the server is up and CORS blocked it (hints for
  Ollama, LM Studio, vLLM); if not, it's unreachable. Also: refused key, a URL without
  `/models` ("usually ends in /v1"), missing model. Plain `http://` to another machine from an
  `https://` page is flagged as mixed content without trying.
- **Retries after switching engines** use whatever is chosen at retry time; "Retry all failed"
  is the way to re-run failed lines on a new engine.
- **The hallucination filter** keeps transcripts from servers without segment scores (plain
  `json`, or missing `no_speech_prob` / `avg_logprob`); the text checks still apply.
- **Tests:** the mock upstreams answer CORS preflights. A new e2e runs against a second app
  server with no upstreams: all three tasks on Custom (the mock, with its auth header; a wrong
  header is reported as a refused key), then a session and a summary with no `/api/*` call.

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
  `lib/api/schemas.ts`.
- **Errors:** `EngineError { kind, retryable }` in `lib/errors.ts`; `ApiError` extends it with
  the same retry rule (network, 408, 429, 5xx). The queue and summary check the kind, not the
  HTTP client. The access-token header name lives there too, shared by client and server.
- **The queue hands raw samples to `transcribe`.** WAV encoding moved into the server adapter in
  `lib/session/controller.ts`; on-device engines will take the `Float32Array` as is.
- **Smaller pieces:** one glossary formatter (`lib/prompts/glossary.ts`), one `Semaphore` /
  `mapLimit` (`lib/util/concurrency.ts`), guarded localStorage helpers (`lib/browser/storage.ts`;
  zustand `persist` and the inline theme script keep their own), summary generation in a
  `useSummary` hook (`lib/session/use-summary.ts`), and `components/ui.tsx` split into
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
