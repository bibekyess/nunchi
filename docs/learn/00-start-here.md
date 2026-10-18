# 00 — Start here

## What nunchi is

nunchi (눈치, "reading the room") listens to a meeting and shows, line by line, what was said
and its translation: Korean → English and English → Korean. It can also write a summary of
the meeting.

It is a **web app**. It runs in the browser (phone or laptop), and a small server sits behind
it. The heavy AI work is done by two **upstream** model servers:

- **Speaches**: a speech-to-text server running **Whisper**. Audio goes in, text comes out.
- **vLLM running Qwen**: a large language model (LLM) server. It translates and summarizes.

Both speak the **OpenAI-compatible API**, a de-facto standard HTTP interface. That one choice
shapes a lot of the architecture (see chapter 08).

## The repository map

```
nunchi/
├── app/                    Next.js routes: pages (UI) and API endpoints
│   ├── page.tsx              home page  (/)
│   ├── session/[id]/page.tsx a live session  (/session/<uuid>)
│   ├── api/                  server endpoints the browser calls
│   │   ├── transcribe/route.ts   audio  → text   (calls Speaches)
│   │   ├── translate/route.ts    text   → text   (calls the LLM, streamed)
│   │   ├── summarize/route.ts    lines  → markdown summary (streamed)
│   │   ├── health/route.ts       "are the upstreams up?"
│   │   └── live/route.ts         "is this server up?" (Docker healthcheck)
│   ├── layout.tsx            the HTML shell every page shares
│   └── globals.css           Tailwind + design tokens (colors, fonts)
│
├── components/             React UI pieces (buttons, transcript, dialogs…)
│
├── lib/                    All the logic. Grouped by what the code is FOR:
│   ├── types.ts, errors.ts, languages.ts   imported by almost everything
│   ├── audio/       microphone, tab capture, voice detection (VAD), WAV encoding
│   ├── pipeline/    the job queue: clip → transcribe → filter → translate
│   ├── core/        portable pipeline logic (runs in browser AND server)
│   ├── prompts/     the text prompts sent to the LLM
│   ├── engines/     "who does the work": Server, Custom endpoint, (On-device)
│   ├── settings/    which engine per task, custom endpoint configs
│   ├── session/     the live session: controller + state store + summary hook
│   ├── db/          saving sessions in the browser (IndexedDB via Dexie)
│   ├── display/     reading preferences (filter, text size, layout)
│   ├── browser/     small browser helpers (localStorage, wake lock, theme, online)
│   ├── server/      server-only code (env, auth, HTTP helpers, logging)
│   ├── api/         the HTTP contract between browser and server (zod schemas)
│   └── util/        generic helpers (semaphore, stream timeouts)
│
├── tests/
│   ├── unit/        fast tests of single modules
│   ├── integration/ API routes tested with fake upstreams (MSW)
│   ├── e2e/         a real Chromium drives the real built app (Playwright)
│   └── fixtures/    audio files used by tests
│
├── scripts/         dev tools: mock upstream server, smoke test, asset copier
├── docs/            DECISIONS.md, ENGINES-PLAN.md, and this guide
├── instrumentation.ts  runs once at server start (checks the config)
├── next.config.ts      Next.js config + security headers
├── Dockerfile, docker-compose.yaml   deployment
└── package.json        dependencies and the `pnpm` commands
```

**Why `lib/` is grouped this way:** DECISIONS.md (2026-10-18, "lib layout") says that the
folder a file sits in tells you what it may depend on. `lib/core/` may not import React or
server code, `lib/server/` is never sent to the browser, and so on. Chapter 12 explains these
rules and how ESLint enforces them.

## The three places code runs

This is the single most important idea for a beginner, because the same repo contains code
for three different environments:

```
┌──────────────────────────── the user's browser ─────────────────────────────┐
│  React UI (components/)      session controller, queue, VAD (lib/…)          │
│  Saves sessions in IndexedDB.  Sends audio/text to an "engine".              │
└───────────────┬──────────────────────────────────────────┬──────────────────┘
                │ Server engine: fetch('/api/…')           │ Custom engine: fetch to
                ▼                                          │ the user's own server
┌──────── the nunchi server (Next.js, Node.js) ──────┐      │ (Ollama, LM Studio…)
│  app/api/*/route.ts + lib/server/*                 │      │
│  Holds the secrets. Validates, limits, logs.       │      │
└───────────────┬───────────────────┬────────────────┘      │
                ▼                   ▼                       ▼
        Speaches (Whisper)     vLLM (Qwen)           any OpenAI-compatible server
```

- **Browser** code is everything under `components/` and most of `lib/`. Files that need
  browser-only features start with `'use client'` (components) or are only imported from
  client code.
- **Server** code is `app/api/**` and `lib/server/**`. Those files start with
  `import 'server-only'`, which makes the build fail if browser code ever imports them, so
  secrets can't leak into the JavaScript sent to users.
- **Portable** code (`lib/core/`, `lib/util/`) runs in both. The translation logic, for example,
  runs on the server in Server mode and in the browser in Custom mode. It's the same file.

## Glossary

| Term                  | Meaning                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Utterance**         | One spoken line: its audio clip, transcript, translation and status. The core data type (`lib/types.ts:13`).           |
| **Clip**              | The raw audio of one utterance, as `Float32Array` samples at 16 kHz (`lib/audio/vad.ts:9`).                            |
| **Session**           | One meeting: title, language mode, glossary, list of utterances, summary (`lib/types.ts:33`).                          |
| **VAD**               | Voice Activity Detection: a small model that decides "is someone speaking right now?"                                  |
| **Silero**            | The VAD model used (Silero VAD v5), run in the browser via ONNX Runtime.                                               |
| **Whisper**           | OpenAI's open speech-recognition model. Runs inside Speaches.                                                          |
| **Speaches**          | An open-source server that serves Whisper behind an OpenAI-compatible API.                                             |
| **LLM**               | Large Language Model. Here Qwen, served by vLLM.                                                                       |
| **vLLM**              | A fast LLM serving engine, OpenAI-compatible.                                                                          |
| **OpenAI-compatible** | Any server that implements OpenAI's HTTP API shape (`/v1/chat/completions`, `/v1/audio/transcriptions`, `/v1/models`). |
| **SSE**               | Server-Sent Events: the text format LLM servers use to stream answers piece by piece.                                  |
| **Engine**            | Whoever does a task: `server` (this app's API), `endpoint` (user's own server), `device` (in-browser, planned).        |
| **Upstream**          | A server _behind_ our server (Speaches, vLLM).                                                                         |
| **Glossary**          | User-entered names/terms ("지민 → Jimin") to get spellings right.                                                      |
| **Hallucination**     | Text a model invents that wasn't said (Whisper does this on silence).                                                  |
| **Zustand**           | A small state-management library for React.                                                                            |
| **Dexie**             | A friendly wrapper around IndexedDB, the browser's built-in database.                                                  |
| **zod**               | A library that validates data at runtime and gives TypeScript types.                                                   |
| **AbortSignal**       | The standard way in JavaScript to cancel async work (a fetch, a wait).                                                 |

## Running things

You need Node 22+ and pnpm 10 (`corepack enable` gives you pnpm).

```bash
pnpm install          # also copies the VAD model into public/vad/ (postinstall)

# Run everything locally without any GPU servers:
pnpm mock             # terminal 1: fake Speaches + fake LLM on :8787
pnpm dev:mock         # terminal 2: the app, pointed at the mock → http://localhost:3000
pnpm smoke            # terminal 3: scripted check of the API routes

pnpm test             # unit + integration tests (fast, no browser)
pnpm e2e              # browser tests (run `pnpm build` first)
pnpm lint && pnpm typecheck
```

The mock (`scripts/mock-upstreams.mjs`) answers with canned Korean sentences and
translations, so you can click around the full app on a laptop. Chapter 11 has the details.

## How to read code you don't know

1. **Start from types.** Open `lib/types.ts` and `lib/engines/types.ts`. Interfaces tell you
   the shape of the data and the "contracts" between parts, without the details.
2. **Follow one flow end to end.** Chapter 01 traces a single sentence. Keep the files open
   side by side as you read it.
3. **Read the tests.** `tests/unit/queue.test.ts` is like executable documentation for
   `lib/pipeline/queue.ts`: each `it('…')` names a behavior.
4. **Read the comments.** This codebase puts the _reason_ in comments (look for the `/** … */`
   blocks above functions). They are short and worth reading.
5. **Use "Go to Definition"** (F12 in VS Code) and "Find All References" (Shift+F12)
   constantly.

## Try it

1. Run `pnpm mock` and `pnpm dev:mock`, open http://localhost:3000, start a session and allow
   the microphone. Speak; the mock will answer with canned lines no matter what you say.
2. Watch the terminal running `pnpm dev:mock`: each API call logs one line, like
   `[translate] ok open=… ttft=… dir=ko->en out=…ch total=…ms rid=…`. Chapter 07 explains
   every field.
3. Open DevTools → Application → IndexedDB → `nunchi`, and find your session and its
   utterances.
