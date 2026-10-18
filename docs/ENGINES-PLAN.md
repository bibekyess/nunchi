# Engines plan: Server, Custom endpoint and On-device processing

Status: approved 2026-10-17. Phases 0, 1 and 2 done, plus a hardening pass before Phase 3
(see `docs/DECISIONS.md`).

## Why

nunchi currently sends every clip to self-hosted servers (Speaches for speech-to-text, a Qwen
server on vLLM for translation and summaries). We want users to be able to choose, per task:

- **Server**: today's behavior. Route handlers call the GPU servers with server-side secrets.
- **Custom endpoint**: the browser calls any OpenAI-compatible URL the user enters (for
  example Speaches, Ollama or LM Studio on `localhost`). The fastest way to run on-device.
- **This device**: models run in the browser on WebGPU.

### Findings that shaped the plan (October 2026)

- On a laptop or desktop with a decent GPU, fully on-device is realistic:
  whisper-large-v3-turbo on WebGPU via transformers.js 4.3 (Korean FLEURS CER about 5.2 vs
  4.9 for large-v3; about 1.5 GB with an fp16 encoder and q4f16 decoder) plus Chrome's
  built-in Translator API (desktop Chrome/Edge only, ko and en supported) or TranslateGemma 4B
  (about 2.7 GB).
- On phones it is not realistic yet: only whisper-small fits safely, and it is weak on
  Korean. iOS kills tabs over a memory limit (about 2 GB reported on iOS 26), and Chrome's
  Translator API does not run on mobile.
- Whisper always encodes a padded 30 s window, so every clip costs one full encoder pass.
  Speech-to-text and translation share one GPU and must run one at a time.
- On-device is not the same as offline: the app shell needs a service worker to open
  without a network.
- Next.js stays. The app already does its heavy work in the browser, and the server routes
  remain the Server mode. Models load only in a Web Worker on the client.

## Design

Today the useful logic lives in the API routes (`app/api/translate`, `app/api/summarize`,
`app/api/transcribe`): prompts, `<think>` removal, empty-output retry, chunked summaries
and the unsupported-language fallback. Phase 0 moves it into `lib/core/`, which depends only
on two small interfaces:

- `ChatModel`: messages in, streamed text out.
- `SpeechModel`: audio in, transcript out.

```
                 lib/core (translate, summarize, transcribe + fallback)
                      ▲                         ▲
 Server mode:  API routes use it        Custom / On-device: the browser uses it
               with server models       with endpoint or WebGPU models
```

The queue, store, voice detection, Dexie storage and UI stay as they are. They call
`transcribe` / `translate` / `summarize` on whichever engine is selected.

## Working rules

- Each phase starts with a list of the exact files and changes, confirmed before editing.
- One conventional commit per item; `docs/DECISIONS.md` updated; tests with every pipeline
  change.
- `PLAN.md` is the user's working copy and is never edited by the agent.

---

## Phase 0: Cleanup with no behavior change

Rule: existing unit, integration and e2e tests keep passing without edits, except tests
that move together with their code.

| #    | Where                                         | What                                                                                                                                                                                                                                                                                                       |
| ---- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1  | new `lib/core/models.ts`                      | `ChatModel` interface (`stream(messages, {temperature, maxTokens, signal, timeoutMs})` returning streamed text, plus `complete(...)`) and `SpeechModel` (`transcribe(wav, {language, prompt, signal})`). Move `ChatMessage` here; `prompts/summarize.ts` currently imports it from `prompts/translate.ts`. |
| 0.2  | new `lib/core/translate.ts`                   | `runTranslation(chat, input, onDelta, signal)`: prompt, temperature 0.2 (0 on retry), `<think>` removal, one retry on empty output. From the translate route.                                                                                                                                              |
| 0.3  | new `lib/core/summarize.ts`                   | `runSummary(chat, input, onDelta, signal)`: filter, sort and format lines, split into parts, summarize up to 2 parts at a time, merge and stream. From the summarize route.                                                                                                                                |
| 0.4  | new `lib/core/transcribe.ts`                  | `transcribeWithFallback(speech, audio, opts)`: the unsupported-language retry. From the transcribe route.                                                                                                                                                                                                  |
| 0.5  | `lib/server/llm.ts`, `lib/server/speaches.ts` | Wrap the existing OpenAI SDK and Speaches clients as the server `ChatModel` and `SpeechModel`. The vLLM no-thinking flag lives inside the server chat model.                                                                                                                                               |
| 0.6  | 3 routes + `lib/server/http.ts`               | Routes become: access check, validate, call core, stream. Shared `parseJsonBody(request, schema)` and `streamText(...)` helpers; one `toUpstreamError`.                                                                                                                                                    |
| 0.7  | new `lib/schemas.ts`                          | Shared zod schemas (`lang`, `glossary`, `context`) for the routes now and settings later.                                                                                                                                                                                                                  |
| 0.8  | `lib/prompts/*`                               | Merge the two glossary formatters. Prompt wording unchanged (prompt tests prove it).                                                                                                                                                                                                                       |
| 0.9  | new `lib/util/concurrency.ts`                 | One `Semaphore` / `mapLimit` used by `queue.ts` and the summary parts.                                                                                                                                                                                                                                     |
| 0.10 | new `lib/storage.ts`                          | `readJson(key, sanitize)` / `writeJson` / `readString` replacing the hand-written localStorage helpers. Key names unchanged, so no migration.                                                                                                                                                              |
| 0.11 | new `lib/errors.ts`                           | `EngineError { kind: network \| timeout \| auth \| bad_request \| upstream \| unavailable, retryable }`. `queue.ts` and `SummaryPanel` stop depending on `ApiError` directly. One shared access-token header constant (today in `api-client.ts` and `server/auth.ts`).                                     |
| 0.12 | `lib/pipeline/queue.ts`                       | `transcribe` takes `Float32Array` audio; WAV encoding moves into the engines that need it.                                                                                                                                                                                                                 |
| 0.13 | `components/summary/SummaryPanel.tsx`         | Generate/abort/error logic moves into a `useSummary` hook under `lib/`; the component only renders.                                                                                                                                                                                                        |
| 0.14 | `components/ui.tsx`                           | Split into `components/ui/{button,dialog,menu,segmented,field,badge,card}.tsx` with an `index.ts` re-export, so imports don't change.                                                                                                                                                                      |
| 0.15 | tests + `docs/DECISIONS.md`                   | Unit tests for `lib/core/*` with fake models. Record the new structure.                                                                                                                                                                                                                                    |

Done when: `pnpm typecheck`, `pnpm lint`, `pnpm test` and e2e pass, `pnpm smoke` against
`pnpm mock` gives the same output, and the routes are mostly validation plus a core call.

## Phase 1: Choose the engine per task

| #   | Where                                          | What                                                                                                                                                                     |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1 | new `lib/engines/types.ts`                     | `SpeechEngine`, `TranslateEngine`, `SummaryEngine`, each with `status()` (ready / needs-setup / downloading(progress) / unavailable(reason) / error) and `needsNetwork`. |
| 1.2 | new `lib/engines/server.ts`                    | The current `/api/*` fetch calls, moved from `api-client.ts`.                                                                                                            |
| 1.3 | new `lib/settings/engines.ts`                  | Per-device settings (zod, key `nunchi.engines`): `{ speech, translate, summary }`, each `'server' \| 'endpoint' \| 'device'`, plus endpoint configs. Default `server`.   |
| 1.4 | new `lib/engines/registry.ts`                  | Builds active engines from settings. The queue reads them per job, so changes apply from the next utterance.                                                             |
| 1.5 | `lib/session-controller.ts`, `queue.ts`        | Wire in the registry. Wait for the network only when the engine needs it.                                                                                                |
| 1.6 | `lib/server/env.ts`, `app/api/health`          | Server URLs become optional; health returns `not_configured` and the Server option is hidden.                                                                            |
| 1.7 | new `components/controls/ProcessingDialog.tsx` | From the header ⋯ menu and home page. Rows for Speech, Translation, Summary, each Server / Custom / This device. Unavailable options disabled with the reason.           |
| 1.8 | `HealthDot.tsx`, `Banners.tsx`                 | Status per task. Offline and passcode banners only when they apply to the active engines.                                                                                |
| 1.9 | `lib/types.ts`                                 | Optional `Session.engines` recording which engine produced the session.                                                                                                  |

Done when: the dialog works, Server mode behaves exactly as today, and choices survive a
reload.

## Phase 2: Custom endpoint

| #   | Where                               | What                                                                                                                                                                                                               |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2.1 | new `lib/core/openai-compatible.ts` | Small fetch-based client with SSE parsing: `ChatModel` (`/chat/completions`) and `SpeechModel` (`/audio/transcriptions`, `verbose_json`). Works in browser and Node.                                               |
| 2.2 | `lib/engines/endpoint.ts`           | Endpoint engines = core + 2.1. The browser calls the endpoint directly; the Next.js server never forwards user-entered URLs (that would be an open proxy / SSRF).                                                  |
| 2.3 | Settings UI                         | Presets: Speaches `localhost:8000/v1`, Ollama `localhost:11434/v1`, LM Studio `localhost:1234/v1`, custom. Fields: URL, model (from `/models`), optional API key or custom header, "disable thinking (Qwen/vLLM)". |
| 2.4 | Test connection                     | `/models` plus one tiny request. Tells a CORS block apart from a wrong key or a down server, with hints (`OLLAMA_ORIGINS`, LM Studio CORS switch, vLLM `--allowed-origins`).                                       |
| 2.5 | `hallucinations.ts`                 | Skip the no-speech check when a server returns no segment scores. Tests.                                                                                                                                           |
| 2.6 | Security and docs                   | Note that the key is stored in this browser. Mixed content: `http://localhost` works from an https page (after Chrome's local-network prompt); `http://192.168…` does not.                                         |
| 2.7 | optional                            | Server uses the same client; drop the `openai` package.                                                                                                                                                            |
| 2.8 | Tests                               | SSE parser and error unit tests (MSW); one e2e against `pnpm mock` through endpoint mode.                                                                                                                          |

Done when: a full session works against a local Speaches + Ollama with the server upstreams
off, and against the mock in e2e.

## Hardening before Phase 3 (done)

From an independent review of Phases 0–2; details in `docs/DECISIONS.md`.

| #   | What                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------ |
| H1  | Idle timeout on every stream (SSE, server engine bodies, server `streamText`); overall limit on `/api/*` calls     |
| H2  | Leaving mid-start closes the mic; the queue ignores clips after dispose; force-split race fixed                    |
| H3  | Per-job cancel on clip eviction; cancellable `waitForOnline`                                                       |
| H4  | `SpeechModel` takes `Float32Array`; `/api/transcribe` decodes and validates the WAV; Speaches on the shared client |
| H5  | FIFO semaphore handoff                                                                                             |
| H6  | One `endpointClient()` and `hostOf`                                                                                |
| H7  | One endpoint validator (`endpointIssues`); pure `engine-settings.ts` + `use-engine-settings.ts`                    |
| H8  | `lib/engines/ids.ts` leaf module; lint rule keeping `lib/core`, `lib/util` and pure settings portable              |
| H9  | Request size caps, summary input cap, config check at boot, 429 mapping                                            |
| H10 | Tests for the above, summary supersede/abort, retry-all; docs                                                      |

## Phase 3: On-device with WebGPU (laptop/desktop)

**3.0 Test build (go/no-go gate)** behind a hidden flag:

- whisper-large-v3-turbo in a Web Worker with transformers.js 4.3 (fp16 encoder + q4f16
  decoder, and all-q4).
- Chrome Translator API vs TranslateGemma 4B vs Qwen3.5 2B/4B (the last two accept the full
  prompt with glossary and context).
- Confirm in transformers.js: (a) detected language is returned (auto mode needs it),
  (b) prompt support for glossary spelling, (c) confidence and no-speech scores can be read
  from the generation output.

Gate: median end of speech → translation start ≤ 3 s on the target laptop, and acceptable
Korean quality vs Server mode on the fixture plus a 10-minute talk. Record numbers in
DECISIONS.

| #    | Where                                             | What                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1  | new `lib/device/worker.ts` + `client.ts`          | One module worker (`new Worker(new URL(...), {type:'module'})`) with a typed protocol: load, progress, transcribe, generate, dispose. One GPU queue: speech before translation. transformers.js loaded only in device mode.                                                                                                                                                   |
| 3.2  | `lib/engines/device-speech.ts`                    | Whisper engine; hallucination signals from 3.0(c) or text-only filters.                                                                                                                                                                                                                                                                                                       |
| 3.3  | `lib/engines/device-translate.ts`                 | Chrome Translator adapter (`availability()`, download progress, `translateStreaming`); glossary terms protected by substitution. Plus the WebGPU LLM option if the test build favors it.                                                                                                                                                                                      |
| 3.4  | Capability check                                  | WebGPU adapter, `shader-f16`, buffer limits, `deviceMemory`; explain disabled options.                                                                                                                                                                                                                                                                                        |
| 3.5  | Model manager UI                                  | Size, download progress, delete, storage estimate, `navigator.storage.persist()`.                                                                                                                                                                                                                                                                                             |
| 3.6  | Offline startup                                   | Service worker caching the app shell, VAD model and WASM files (Next 16 PWA guide). Restores the PWA manifest.                                                                                                                                                                                                                                                                |
| 3.7  | Summary on device                                 | Experimental, smaller parts; default suggests Server or Endpoint.                                                                                                                                                                                                                                                                                                             |
| 3.8  | Runtime duplication                               | vad-web uses onnxruntime-web 1.30, transformers.js pins 1.31-dev: separate WASM paths, extend `scripts/copy-vad-assets.mjs`.                                                                                                                                                                                                                                                  |
| 3.9  | Tests                                             | Worker logic with a fake pipeline; e2e with a fake device engine; manual hardware checklist including an airplane-mode session.                                                                                                                                                                                                                                               |
| 3.10 | `lib/engines/registry.ts`, `types.ts`             | Engine lifecycle: a factory table `Record<EngineId, Record<EngineTask, Factory>>` with instances cached per settings, and optional `prepare(signal)` / `dispose()` on engines; `BUILT_ENGINES` and the if/else chains derive from the table.                                                                                                                                  |
| 3.11 | `lib/engines/types.ts`                            | Status model: add `needs_download` (with size) and `downloading` (progress), plus `subscribe(cb)` beside `status()`; `needsNetwork` becomes a function (a model not yet downloaded needs the network).                                                                                                                                                                        |
| 3.12 | `lib/device/scheduler.ts`, queue                  | One GPU scheduler shared by device engines (speech ahead of translation), or engine-declared concurrency; the queue stays unaware of the transport. Built on the FIFO `Semaphore`.                                                                                                                                                                                            |
| 3.13 | `lib/settings/engine-settings.ts`, `lib/types.ts` | Device settings `device: { speech: { model }, translate: { backend: 'chrome' \| 'webgpu', model } }` with sanitize and migration tests; `Session.engines` also records endpoint and device model ids.                                                                                                                                                                         |
| 3.14 | session + device runtime                          | `navigator.locks`: one tab per live session, and one device runtime (model weights) per browser.                                                                                                                                                                                                                                                                              |
| 3.15 | `lib/device/*` layout                             | `protocol.ts` (typed messages, `lib/core` types only), `worker.ts` (imports only `lib/core`, `lib/core/think-stripper`, transformers.js), `client.ts` (request ids, AbortSignal → cancel message, `withIdleTimeout`), `capabilities.ts`, `models.ts` (download manager, storage estimate). Extend the portable-imports lint rule to `lib/device/worker.ts` and `protocol.ts`. |

Done when: a 10-minute Korean session runs in airplane mode on the target laptop and meets
the gate.

## Phase 4: iPhone WebGPU exploration (research, no commitment)

- Devices: iPhone 15 Pro / 16 / 17 (8 GB), iOS 26 Safari, debugged with Safari Web Inspector.
- Matrix: whisper base / small / turbo-q4f16, Qwen3.5 0.8B/2B. Measure load time, latency,
  peak memory, memory-limit crashes, heat over 30 minutes, screen-lock behavior.
- Verify: Safari deletes site storage after 7 days without use unless the app is on the
  home screen (models would re-download); storage quota; mic plus WebGPU in the background.
- Likely outcome: on-device speech-to-text with Server/Endpoint translation, or a native
  wrapper using iOS's built-in Korean speech recognition and translation. Written up as a
  go/no-go note.
