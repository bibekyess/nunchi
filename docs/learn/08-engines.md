# 08 — Engines: Server, Custom endpoint, On-device

Each of the three tasks (speech to text, translation, summary) can run on a different
**engine**, chosen per device in the **Processing** dialog:

| Engine id  | Label       | Who does the work                                                                  | Status                  |
| ---------- | ----------- | ---------------------------------------------------------------------------------- | ----------------------- |
| `server`   | Server      | this app's `/api/*` routes → the GPU servers                                       | built                   |
| `endpoint` | Custom      | any OpenAI-compatible server the user enters, **called directly from the browser** | built                   |
| `device`   | This device | models running in the browser on WebGPU                                            | planned ("coming soon") |

This chapter shows how the code is arranged so that adding an engine doesn't touch the
pipeline. It's the clearest example in the repo of **ports and adapters** (chapter 12).
Background and research are in [`../ENGINES-PLAN.md`](../ENGINES-PLAN.md).

---

## Part 1: The layers

```
 ┌────────────────────────────────────────────────────────────────────────────┐
 │ Callers: PipelineQueue (speech, translate) · generateSummary (summary)    │
 │          They call engine.transcribe / translate / summarize. That's all. │
 └──────────────────────────────┬─────────────────────────────────────────────┘
                                │ Engines interface  (lib/engines/types.ts)
                                ▼
 ┌────────────────────────────────────────────────────────────────────────────┐
 │ Registry (lib/engines/registry.ts): settings → { speech, translate, summary }│
 └───────┬───────────────────────────┬─────────────────────────────┬──────────┘
         ▼                           ▼                             ▼
  serverProvider              endpointProvider               comingSoonProvider('device')
  lib/engines/server.ts       lib/engines/endpoint.ts        every call fails "unavailable"
  fetch('/api/…')             lib/core/* + OpenAI client
         │                    in the browser
         ▼
  app/api/* routes  ──► lib/core/* + OpenAI client on the server
```

There are two kinds of interface here:

1. **Engine interfaces** (`lib/engines/types.ts`): what the _pipeline_ needs. "Transcribe these
   samples", "translate this line and stream it to me", plus `status()` and `needsNetwork`.
2. **Model interfaces** (`lib/core/models.ts`): what the _core logic_ needs. `ChatModel`
   (messages in, streamed text out) and `SpeechModel` (samples in, transcript out).

The core logic (prompts, `<think>` stripping, retries, chunked summaries, the language
fallback) is written once, against the model interfaces. It then runs:

- **on the server** for the Server engine: the routes pass `serverChat`/`serverSpeech`
  (`lib/server/llm.ts`, `lib/server/speaches.ts`),
- **in the browser** for the Custom engine: `endpoint.ts` passes a client built from the
  user's settings,
- **in a Web Worker** for the future device engine.

ENGINES-PLAN.md shows the same idea:

```
                 lib/core (translate, summarize, transcribe + fallback)
                      ▲                         ▲
 Server mode:  API routes use it        Custom / On-device: the browser uses it
```

---

## Part 2: The engine interface

`lib/engines/types.ts`, shortened:

```ts
interface EngineBase {
  readonly id: EngineId; // 'server' | 'endpoint' | 'device'
  readonly needsNetwork: boolean; // should work wait while offline?
  status(signal?): Promise<EngineStatus>; // ready / not_configured / unavailable / error
}
interface SpeechEngine extends EngineBase {
  transcribe(audio: Float32Array, opts): Promise<TranscriptionResult>;
}
interface TranslateEngine extends EngineBase {
  translate(request, onDelta, signal?): Promise<string>;
}
interface SummaryEngine extends EngineBase {
  summarize(request, onDelta, signal?): Promise<string>;
}
```

Things to notice:

- **`transcribe` takes raw samples** (`Float32Array`), not a WAV file. Each engine encodes what
  its transport needs: the server engine makes a WAV for `/api/transcribe`, and a future
  in-browser Whisper would use the samples directly (DECISIONS.md, Engines Phase 0 and the
  hardening pass).
- **Streaming via a callback** (`onDelta`) plus a final `Promise<string>` with the full text.
  Callers get both live updates and the complete result.
- **`needsNetwork`** lets the queue decide whether to wait for connectivity. It's `true` for
  Server and for Custom endpoints on other machines, and `false` for `localhost`
  (`isLoopback`, `lib/engines/endpoint.ts:32`), so a local Ollama keeps working on a plane.
- **`status()`** powers the badges ("Servers ready", "Translation down") and the Processing
  dialog.

---

## Part 3: The registry: one table

`lib/engines/registry.ts:42`:

```ts
const PROVIDERS: Record<EngineId, EngineProvider> = {
  server: serverProvider,
  endpoint: endpointProvider,
  device: comingSoonProvider('device', 'This device'),
};
```

An `EngineProvider` (`types.ts:91`) has a label, a `built` flag, and a factory per task.
`buildEngines(choice, endpoints)` (line 58) picks one provider per task.

`Record<EngineId, EngineProvider>` forces the table to have an entry for **every** engine id.
Add `'webgpu'` to `ENGINE_IDS` and TypeScript reports the missing entry. The comment says it:
_"A new engine is one entry here."_ Labels, the "coming soon" list (`BUILT_ENGINES`) and the
dialog are all derived from this table.

### Read per job, not once

`getEngines()` (line 70) reads the **current** settings each time it's called, and the queue
calls it for each job. Switching engines mid-meeting applies from the next line, with no
restart.

### No silent fallback

`comingSoonProvider` (line 21) stands in for an engine that isn't built yet. That covers a
choice saved by a newer version of the app, or a hand-edited localStorage. Every call
**fails** with an `unavailable` error. It never quietly sends the work to the server instead.
The comment and DECISIONS.md (Engines Phase 1) explain why: _"someone who picked on-device
processing may not want their audio sent anywhere."_ Here privacy beats convenience.

---

## Part 4: The Server engine (`lib/engines/server.ts`)

The browser side of the app's own API:

- **`send()`** (line 131): `fetch` with the passcode header and an **overall time limit** per
  call (`CALL_TIMEOUT_MS`, line 95: transcribe 90 s, translate 150 s, summarize 20 min,
  health 10 s). It's built with `AbortSignal.any([caller's signal, own timeout])`, so a user
  cancel still looks like a cancel (an `AbortError`) and a timeout looks like a retryable
  timeout.
- **`ApiError`** (line 71) turns HTTP status + the server's `{ error: { code } }` into an
  `EngineError` kind. Note `not_configured` → `unavailable` (not retryable) and 429 →
  `upstream` (retryable: the server is busy, the request isn't wrong).
- **Responses are validated** with the shared zod schemas (`readJson`, line 160).
- **Shared health check** (`sharedHealth`, line 298): the three server engines would each call
  `/api/health` for their status, so one result is shared for 2 seconds. A _failed_ check is
  not cached, so the next check tries again.
- **The access token** lives in localStorage, with a tiny subscription system
  (`subscribeAccessToken`, line 46) so React components refresh their status when it changes.
  `unlockServer()` (line 317) sends the passcode to `/api/unlock` and stores only the 7-day
  token it gets back, never the passcode itself. A wrong passcode is refused there, so a typo
  isn't stored (chapter 07, ②).

---

## Part 5: The Custom engine (`lib/engines/endpoint.ts`)

The browser calls the user's server directly, with the same `lib/core` logic the server uses:

```ts
export function endpointTranslate(config: EndpointConfig): TranslateEngine {
  return {
    id: 'endpoint',
    needsNetwork: !isLoopback(config.baseUrl),
    status: (signal) => status(config, 'chat', signal), // GET /models, 5 s
    translate: (request, onDelta, signal) =>
      withHints(async () => {
        requireComplete(config, 'translate'); // fail fast if not filled in
        return runTranslation(endpointClient(config, 'chat').chat, request, onDelta, signal);
      }),
  };
}
```

- `endpointClient` (line 50) builds the OpenAI-compatible client from the saved settings: URL,
  model, API key (`Authorization: Bearer`), an optional custom header, and vLLM's no-thinking
  flag if the switch is on. The same function is used by **Test connection**, so the test
  checks exactly what the engine will use (DECISIONS.md, "One endpoint client").
- `requireComplete` (line 70): an unfilled endpoint throws `unavailable`, which is not
  retried, with a message pointing at Processing settings.
- `withHints` (line 82): a refused key gets _"Check the API key in Processing settings"_ and is
  marked non-retryable. It never opens the app-passcode banner (that's only for
  `engine: 'server'`).
- The summary can borrow the translation endpoint ("Same as translation", `endpointFor` in
  `lib/settings/engine-settings.ts:191`).

### Things that make browser → server calls hard

These come up when a user sets up Custom mode, and the code handles each one:

- **CORS.** A browser only lets a page read a response from another origin if that server
  sends `Access-Control-Allow-Origin`. Ollama, LM Studio and vLLM each have a setting for this
  (README, "CORS").
- **Mixed content.** A page served over `https://` may not call plain `http://` on another
  machine. `http://localhost` is the exception.
- **A failed `fetch` doesn't say why.** DNS failure, refused connection, CORS block and mixed
  content all look like the same `TypeError` to JavaScript.

**Test connection** (`lib/engines/endpoint-check.ts:89`) tells them apart anyway:

1. Mixed content is detected from the URLs alone, before any request (line 97).
2. `GET /models`. If that fails with a network error, it sends a **`no-cors` probe**
   (`reachable`, line 32). A `no-cors` request succeeds whenever the server answers, CORS or
   not, but the page just can't read the result. So: probe succeeds → the server is up and
   **CORS** blocked us, and a hint explains how to allow this site. Probe fails → the server
   is **down or the URL is wrong**.
3. 401/403 → refused key. 404 on `/models` → _"OpenAI-compatible URLs usually end in /v1"_.
4. For chat, a **1-token test answer** (60 s, since a local model may need to load first).

---

## Part 6: Settings: stored, sanitized, shared across tabs

Split into two files on purpose (DECISIONS.md, "Settings split"):

- **`lib/settings/engine-settings.ts`: pure.** Types, defaults, validation, load/save. No
  React, no store, nothing that runs on import, so a Web Worker could use it.
- **`lib/settings/use-engine-settings.ts`: live.** A Zustand store, React hooks, and a
  `storage` event listener (line 60) so that **changing settings in one tab updates the other
  tabs**. Both tabs then send work to the same place.

Validation is centralized in **`endpointIssues()`** (line 120). It returns a list of
`{ field, message }`, used by:

- the dialog: shows the first message, highlights every bad field, blocks Save,
- the engines: `endpointProblem()` → "isn't set up" errors,
- saving: `sanitizeEndpoint()` only drops what `endpointIssues` reports.

"One rule set" means the dialog can never accept something the engine will reject. An
earlier version silently dropped a header name with a space on save, which later failed as a
mysterious 401 (DECISIONS.md 2026-10-17, "One endpoint validator").

**Migration.** `sanitizeEngineSettings` (line 171) still reads the older "flat" format
(`{ speech, translate, summary }`) from Engines Phase 1. Users who updated the app keep their
choice.

**Hydration.** `useEngineChoice()` (line 42) returns the default until hydration has finished,
because the server can't see localStorage (chapter 02).

---

## Part 7: Layering rules that keep this working

For `lib/core/` to run anywhere, it must not import React, Next.js, stores, server-only code
or the engines themselves. Two mechanisms enforce that:

- **`lib/engines/ids.ts` is a leaf module** (it imports nothing). Lower layers (`lib/types`,
  `lib/errors`, `lib/core`) can name engines (`EngineId`) without importing the engine code.
  That removed import cycles (DECISIONS.md, "Layering").
- **An ESLint rule** (`eslint.config.mjs:7`, `PORTABLE_IMPORTS`) fails the lint if any file in
  `lib/core/`, `lib/util/` or `engine-settings.ts` imports React, Next, Zustand, `server-only`,
  stores, hooks, components or engines other than `ids`.

A rule that only lives in people's heads gets broken. A lint rule can't be forgotten.

## Try it

1. Run `pnpm mock`, open the app with `pnpm dev:mock`, and in **Processing** set Translation
   to **Custom** with the Ollama preset changed to `http://localhost:8787/v1`, model
   `mock-qwen`. Press Test connection. It fails with a refused key, because the mock requires
   a header. Add header `x-mock-auth: mock-secret` under More options and test again.
2. With translation on Custom, start a session and watch the Network tab: translations now go
   to `localhost:8787` directly, not to `/api/translate`.
3. Stop the mock and press Test connection. Then start any server _without_ CORS (e.g.
   `python3 -m http.server 9999`) and point the URL at `http://localhost:9999/v1`. Compare the
   two messages and trace each one to `explain()` in `endpoint-check.ts`.
4. Try adding `import { useState } from 'react'` to `lib/core/translate.ts` and run
   `pnpm lint`. Read the error, then remove the import.
