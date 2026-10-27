# 12 — Design principles: why the code looks the way it does

You've heard this project is "well structured". This chapter names the ideas behind that,
with concrete examples from the code. Each principle is something you can reuse in your own
projects.

---

## 1. Layers with a clear dependency direction

Code is arranged in layers, and **each layer only imports from layers below it**:

```
  components/  (React UI)
       │
  lib/session/, lib/display/store, lib/settings/use-*   (stores, hooks, controller)
       │
  lib/engines/  (server, endpoint, registry)        lib/server/ (server only)
       │                                                  │
  lib/pipeline/, lib/db/, lib/audio/                       │
       │                                                  │
  lib/core/, lib/prompts/, lib/util/, lib/api/   ◄────────┘   (portable)
       │
  lib/types.ts, lib/errors.ts, lib/languages.ts, lib/engines/ids.ts   (leaves)
```

**Why:** you can understand, test and reuse a lower layer without the upper ones. The same
`lib/core/translate.ts` runs on the server, in the browser, and later in a Web Worker, because
it knows nothing about React or Next.js.

**How it's enforced:** an ESLint rule (`eslint.config.mjs:7`) and a leaf module for shared
names (`lib/engines/ids.ts`, which imports nothing). _A rule that's only written down gets
broken; a rule that fails the build doesn't._

**Folder = purpose.** DECISIONS.md (2026-10-18): `lib/` is grouped _"by what the code is for,
so a file's folder says what it may depend on"_. Also: no barrel files (`index.ts` re-exports)
in `lib/`, so imports name the real file (`@/lib/session/store`) and "Go to definition" lands
where the code is.

## 2. Ports and adapters (depend on interfaces, not implementations)

The pipeline depends on small **interfaces** ("ports"). Concrete classes ("adapters") plug
into them:

| Port (interface)                                                            | Adapters                                                              |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `SpeechEngine`, `TranslateEngine`, `SummaryEngine` (`lib/engines/types.ts`) | server engine, endpoint engine, coming-soon stub, test fakes          |
| `ChatModel`, `SpeechModel` (`lib/core/models.ts`)                           | server LLM/Speaches, OpenAI-compatible client, (future) WebGPU worker |
| `QueueDeps`                                                                 | real browser functions, test fakes                                    |

**Why:** adding Custom endpoints didn't change the queue at all, and adding on-device models
won't either. It's also what makes testing easy (principle 3).

**Adapters translate at the edge.** Outside data formats are converted once, where they enter:
`parseTranscription` turns Whisper's JSON into `TranscriptionResult`, and `normalizeWhisperLanguage`
turns `"korean"` into `ko`. Everything inside sees one clean shape.

## 3. Dependency injection for testability

Instead of reaching out for globals (`fetch`, `Date.now`, `setTimeout`, the database),
functions accept them as parameters with sensible defaults:

```ts
export function persistSession(store, { save = saveSession, now = Date.now } = {}) { … }
export function canCaptureTabAudio(nav = globalThis.navigator) { … }
```

Production code doesn't pass anything, and tests pass fakes. Chapter 11 lists the examples.
**Why:** deterministic tests for timing, network failure, and race conditions, with no
real waiting.

## 4. One source of truth

When two places must agree, define the thing once and derive the rest:

| Defined once                                         | Derived from it                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| `SUPPORTED_LANGS` (`lib/languages.ts`)               | the `Lang` type, zod schemas, menus, prompt wording, column order |
| `ENGINE_IDS` / `ENGINE_TASKS` (`lib/engines/ids.ts`) | types, the registry table, settings validation                    |
| `lib/api/contract.ts`                                | server request validation, browser response validation, paths     |
| `endpointIssues()`                                   | dialog errors, engine "not set up" errors, what saving drops      |
| `PROVIDERS` table                                    | labels, the "built" list, the Processing dialog options           |
| the session store                                    | UI, persistence, the queue's view of utterances                   |

**Why:** they can't drift apart. DECISIONS.md records bugs that came from two rule sets
disagreeing, like the header-name bug in chapter 08.

## 5. Validate at every boundary; trust nothing from outside

Every place where data enters the program is checked:

- **HTTP requests** → zod schemas + size limits (`parseJsonBody`, `readBodyLimited`)
- **HTTP responses** from our own server → zod (`readJson` in `lib/engines/server.ts`)
- **Upstream responses** → defensive parsing (`?? ''`, `?? 0`, skip non-JSON SSE lines)
- **Environment variables** → zod at boot
- **localStorage** → a mandatory sanitize function (`readJson(key, sanitize)`)
- **Uploaded audio** → `decodeWav` accepts exactly one format

Inside the boundary, the types can be trusted. **Why:** bugs and attacks come from the edges.
Checking once at the edge is far cheaper than checking everywhere.

## 6. Fail fast and loudly on configuration; degrade gracefully at runtime

These look opposite, but they apply to different kinds of problems:

- **Configuration problems** (the operator's mistake) → stop at boot with a clear message
  (`instrumentation.ts`). A broken server that looks alive is worse than one that won't start.
- **Runtime problems** (the world's fault) → keep working as well as possible:
  - storage blocked → the session works, unsaved, with a banner,
  - wake lock denied → listening still works,
  - offline → clips wait, capped at 50,
  - mic taken by a phone call → restart automatically, with a banner,
  - one upstream not configured → that task says "not set up", the others work.

## 7. Errors are data, with two audiences

`EngineError` (`lib/errors.ts`) carries a **kind** (`network`, `timeout`, `auth`, …) and a
**retryable** flag. Code decides what to do from those fields, never by parsing message text.

Every error has two audiences:

- the **user** gets a short, safe, actionable `message` ("Check the API key in Processing
  settings"),
- the **operator** gets the `detail` (the upstream's raw body) in the server log, with secrets
  redacted and length capped.

An upstream's raw error is never sent to the browser, since it might echo credentials.

## 8. Cancellation and cleanup everywhere

Anything started must be stoppable, and anything opened must be closed:

- `AbortSignal` is threaded through every async call: queue → engine → fetch → server route →
  upstream fetch. Leaving the page cancels work all the way to the GPU.
- After every `await`, check whether you were cancelled or disposed (`disposed` in
  `SessionController`, `signal.aborted` in the queue and summary).
- Classes with resources have `dispose()`. React effects return cleanup functions.
- Generators use `try/finally` to cancel readers when the consumer stops early.

**Why:** a live app runs for hours. Leaked listeners, open mics and zombie requests accumulate.
Several entries in DECISIONS.md's hardening pass are exactly these leaks.

## 9. Bound everything

Every resource that could grow has a limit, each with a comment explaining the number:

| Limit                                  | Value                                       | Where                  |
| -------------------------------------- | ------------------------------------------- | ---------------------- |
| parallel transcriptions / translations | 2 / 2                                       | `queue.ts:12`          |
| clips waiting offline                  | 50 (~15 MB)                                 | `queue.ts:15`          |
| retries                                | 3 attempts, 1 s / 3 s backoff               | `queue.ts:13`          |
| clip length                            | 25 s                                        | `vad.ts:7`             |
| rejoined lines                         | 700 ms gap, 25 s together                   | `pipeline/rejoin.ts`   |
| request bodies                         | 2 MB audio, 1 MB translate, 2 MB summary    | routes                 |
| summary input                          | 300,000 chars, at most ~13 parts            | `core/summarize.ts:22` |
| Whisper prompt                         | 200 chars                                   | `whisper-prompt.ts:3`  |
| translation output                     | 400 tokens                                  | `core/translate.ts:5`  |
| every network call                     | a timeout, plus an idle timeout for streams | chapter 05             |
| log details                            | 500 chars, stacks 2,000                     | `server/http.ts:233`   |

**Why:** unbounded things fail in production on the day something unusual happens: a
3-hour meeting, a dead connection, a malicious request.

## 10. Retries in exactly one place

Only the job queue retries (and the server's single, specific empty-answer retry). The LLM
client has no automatic retries. **Why:** retries in several layers multiply (3 × 3 = 9
requests), hide problems, and make latency unpredictable.

## 11. Privacy by design

- Audio is **never stored**, only kept in memory until transcribed.
- Sessions live **only on the device**.
- Logs contain **timings and sizes, never text**.
- Choosing an engine that isn't available **fails rather than silently falling back** to the
  server.
- Custom endpoint keys **never pass through the nunchi server**. The server also never fetches
  user-supplied URLs (no open proxy / SSRF).

## 12. Optimize for perceived speed

- Placeholders appear the instant a clip is cut.
- Translations and summaries **stream**, word by word.
- Retries and fallbacks happen **next to the model** when possible (language fallback,
  empty-answer retry), not across the phone's network.
- Heavy assets (the 16 MB VAD) load **lazily**, on first use.
- Rendering is scoped so a streaming line re-renders only itself.

## 13. Few dependencies, small own code

The repo removed the OpenAI SDK in favor of a ~440-line client, and wrote its own logger
(~180 lines), SSE parser and semaphore instead of adding packages. **Why:** each dependency is
code you don't control, with its own bugs, updates and bundle size. When the needed part is
small and well tested, owning it is simpler. (Big, hard problems still use libraries: Dexie,
zod, Zustand, vad-web, react-markdown.)

## 14. Decisions are written down

`docs/DECISIONS.md` records _why_ each choice was made, newest first, and the working rules in
`docs/ENGINES-PLAN.md` require it: _"One conventional commit per item; `docs/DECISIONS.md`
updated; tests with every pipeline change."_ Comments in the code explain _why_, not _what_.

**Why:** six months later, nobody remembers why the redemption time is 600 ms or why the WAV
decoder uses `(v + 0.5)`. Without the record, someone "simplifies" it and reintroduces the
bug.

---

## A checklist for your own changes

Before you change something, ask:

1. **Which layer does this belong in?** Could it be portable (`lib/core`), or does it need the
   browser, React, or the server?
2. **Is there already a single source of truth** for this (languages, contract, validator)?
3. **Where does outside data enter, and is it validated there?**
4. **What happens if it's slow, fails, or is cancelled halfway?** Is there a timeout? A retry
   rule? A cleanup?
5. **Is anything unbounded?**
6. **Could a secret or user text end up in a log or an error message?**
7. **How will I test it?** Can the dependencies be injected?
8. **Does DECISIONS.md need an entry?**

## Where to go next

- Re-read `docs/DECISIONS.md` from the bottom (oldest) up. Now that you know the code, it reads
  like the story of how the app was built.
- Read `docs/ENGINES-PLAN.md` Phase 3 (on-device WebGPU) and think about which of the
  principles above make it possible without rewriting the pipeline.
- Pick a small improvement (a new hallucination phrase, a third language, a UI tweak) and do it
  end to end: code, test, DECISIONS.md entry.
