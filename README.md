# nunchi

Live Korean ↔ English transcription and translation for meetings. Next.js PWA powered by
self-hosted Whisper (Speaches) and an OpenAI-compatible LLM (Qwen on vLLM).

The implementation plan lives in the shared plan doc; decisions made while building are in
[`docs/DECISIONS.md`](docs/DECISIONS.md).

## Status

- **Phase 0 — scaffold and connectivity: done.** API routes, validated env, mock upstreams, smoke test.
- **Phase 1 — live MVP: done (verified against mocks in desktop Chromium).** Tap the mic and
  each sentence appears with its translation underneath: in-browser VAD (Silero v5) → WAV →
  job queue (2 at a time, retries, ordered by speech) → transcribe → streamed translation.
  Mic picker and noise-suppression toggle, level meter, language mode, glossary + meeting
  context, auto-scroll with a jump button, wake lock and interruption recovery, offline queueing,
  passcode prompt when `APP_ACCESS_TOKEN` is set. Still to check on real phones (iOS Safari,
  Android Chrome) against the real servers.
- **Phase 2 — quality: built; verified against mocks, tab sharing checked by hand in Chrome.** Cuckoo-style toolbar: an "All languages"
  filter (All / 한국어 / English — filters by language, not by original vs. translation), a
  side-by-side layout with one column per language (≥ 768 px), and a text-size button (S/M/L).
  These are remembered per device. The **Audio** settings (header ⋯ menu) add live-tuned speech detection
  (pause before a line ends 0.3–1.2 s, sensitivity, shortest speech), and on desktop Chrome a
  source picker: microphone, **tab audio** (video calls, YouTube), or both mixed. Still to run
  the Phase 2 acceptance check (10-minute sample: no junk lines, glossary names ≥ 90 % right, no
  line over 30 s) against the real servers.
- **Phase 3 — sessions: done for what's needed (verified against mocks).** Sessions are saved
  on the device (IndexedDB via Dexie) as you go, and come back after a reload or crash; lines
  that were still in flight show as failed, and interrupted translations can be retried. The
  home page lists recent sessions (title, date, listening time, first translated line) with
  rename and delete. A **Summary** tab streams an AI summary (overview, key points, decisions,
  action items, open questions) in Korean or English, rendered as GFM markdown, and saves it
  with the session. Search, Markdown export, Copy all and the installable PWA were left out
  on purpose: the goal is following Korean meetings, not archiving or sharing them.
- **Phases 4–5 (speaker labels, share links, server storage): not planned for now.**
- **Engines (see [`docs/ENGINES-PLAN.md`](docs/ENGINES-PLAN.md)): Phases 0–2 done.** A
  **Processing** dialog (home header and the session ⋯ menu) picks where speech to text,
  translation and summary run: **Server** (this app's upstreams) or **Custom** (your own
  OpenAI-compatible server, called straight from the browser; see
  [Use your own server](#use-your-own-server-custom-endpoint)). This device (on-device models)
  is listed as coming soon.

## Setup

Requires Node 22+ and pnpm 10.

```bash
pnpm install
cp .env.example .env.local   # fill in the real server URLs, model and header
```

## Commands

| Command                     | What it does                                                        |
| --------------------------- | ------------------------------------------------------------------- |
| `pnpm dev`                  | Dev server against the servers in `.env.local`                      |
| `pnpm mock`                 | Fake Speaches + vLLM on `http://localhost:8787/v1` (canned replies) |
| `pnpm dev:mock`             | Dev server pointed at the mock (uses `.env.mock`)                   |
| `pnpm smoke [wav]`          | Health → transcribe a clip → stream its translation, with timings   |
| `pnpm test`                 | Unit + route tests (Vitest, upstreams mocked with MSW)              |
| `pnpm typecheck`            | Next route types + `tsc`                                            |
| `pnpm lint` / `pnpm format` | ESLint / Prettier                                                   |
| `pnpm build`                | Production build (`output: 'standalone'` for Docker)                |

### Smoke test

Against the mock (no GPU servers needed):

```bash
pnpm mock            # terminal 1
pnpm dev:mock        # terminal 2
pnpm smoke           # terminal 3
```

The browser tests (`pnpm e2e`) start the mock and the built app themselves (set
`E2E_MOCK_PORT` if 8788 is taken). They cover the live session, the view filter, text size,
side-by-side layout, reload recovery, the summary tab, the recent-sessions list, the Processing dialog, a full session in Custom mode against a second app server with no upstreams, and tab-audio capture (Chromium's fake capture UI auto-accepts the share). It uses Playwright's
Chromium, or the one at `PLAYWRIGHT_CHROMIUM_PATH` if set. The speech fixture is the public-domain
JFK sample from whisper.cpp.

Against the real servers: run `pnpm dev` with `.env.local`, then
`pnpm smoke path/to/korean-clip.wav`. The committed `tests/fixtures/ko-sample.wav` is a
2 s tone (generated by `scripts/make-fixture.mjs`); Whisper will return nothing useful for it,
so use a real 16 kHz mono Korean recording. Set `SMOKE_BASE_URL` / `APP_ACCESS_TOKEN` if needed.

### Testing on a phone

The microphone needs HTTPS. On the same Wi-Fi, run `pnpm dev --experimental-https` and open the
LAN address on the phone (accept the self-signed certificate), or use a tunnel.

`pnpm install` copies the VAD model and ONNX runtime into `public/vad/` (git-ignored); they load
only when you first tap the microphone (~16 MB, cached afterwards).

## Docker

```bash
cp .env.example .env.local   # fill in the real server URLs, model and header
docker compose up -d --build
```

The app listens on `127.0.0.1:9083` (set `PORT` to change the host port). Put an HTTPS reverse
proxy such as nginx in front: browsers only allow the microphone over HTTPS (or on `localhost`).
The env file is read at container start, never baked into the image. After editing it, run
`docker compose up -d` again to recreate the container.

The configuration is checked once when the server starts (`instrumentation.ts`): an invalid
value stops it with an "Invalid server environment" message listing the problems, instead of
failing every request later. In production, a missing `APP_ACCESS_TOKEN` logs a warning,
since anyone who finds the URL could then use your GPU servers.

## Use your own server (Custom endpoint)

In **Processing**, set any task to **Custom** and point it at an OpenAI-compatible server.
The browser calls that server directly: its URL and API key are stored in this browser only and
never pass through the nunchi server. The app server's own upstreams can even be left empty
(`SPEACHES_BASE_URL`, `LLM_BASE_URL`), and a custom endpoint on `localhost` keeps working
offline.

Speech to text needs `/v1/audio/transcriptions` (Whisper-style); translation and summary need
`/v1/chat/completions`. The summary uses the translation server unless you switch off "Same as
translation". Use **Test connection** after filling in a task: it tells a wrong URL, a CORS
block, a refused key and a missing model apart.

Example: everything on your laptop.

```bash
# Translation and summary: Ollama (http://localhost:11434/v1)
ollama pull qwen3:4b
ollama serve

# Speech to text: Speaches (http://localhost:8000/v1). Use the latest-cuda tag with an NVIDIA GPU.
docker run --rm -p 8000:8000 ghcr.io/speaches-ai/speaches:latest-cpu
```

Then in Processing pick the Ollama and Speaches presets and enter the models (e.g.
`qwen3:4b`, and a Whisper model your Speaches has, such as `Systran/faster-whisper-large-v3`;
see the Speaches docs for downloading models). LM Studio works the same way on
`http://localhost:1234/v1`. For vLLM with Qwen3, turn on "Disable thinking" under More options.

**CORS.** The server must allow requests from the page's address, or the browser blocks the
response:

- Ollama already allows pages on `localhost`. If nunchi runs on another address (e.g. your
  HTTPS domain), start Ollama with that address in `OLLAMA_ORIGINS`, e.g.
  `OLLAMA_ORIGINS=https://nunchi.example.com ollama serve`.
- LM Studio: turn on CORS in its server settings.
- vLLM: `--allowed-origins` (with `--allowed-headers` if you send a custom header).
- Speaches and anything else: check its CORS setting.

**HTTPS and localhost.** A page served over `https://` can't call plain `http://` on another
machine (mixed content): give that server HTTPS too. `http://localhost` is the exception in
Chrome and Edge, which may first ask to allow access to devices on your local network. If your
browser still blocks it, open nunchi itself on `http://localhost`.

## API

All routes return errors as `{ error: { code, message } }` and require the `x-nunchi-token`
header when `APP_ACCESS_TOKEN` is set. Upstream error bodies are logged, never forwarded.

Each upstream is optional. Leave `SPEACHES_BASE_URL` empty (or both `LLM_BASE_URL` and
`LLM_MODEL`) and the routes for that service answer `503` with code `not_configured`; the
Processing settings then show Server as not available for that task.

- `GET /api/health` → `{ speaches, llm }`, each `'ok' | 'error' | 'not_configured'`
- `POST /api/transcribe` (multipart: `audio` ≤ 2 MB, `language` `ko|en|auto`, `prompt` ≤ 200
  chars) → `{ text, language, durationMs, segments: [{ text, noSpeechProb, avgLogprob }] }`.
  The audio must be a 16 kHz mono 16-bit PCM WAV (what the app records); anything else is
  rejected with `400`. In auto mode, a detected language outside Korean/English triggers one
  re-transcription as Korean.
- `POST /api/translate` (JSON: `text, sourceLang, targetLang, context[≤5], glossary, meetingContext?`)
  → streamed `text/plain`. Qwen thinking is disabled via `chat_template_kwargs`, and any
  `<think>` block is stripped anyway. An empty result is retried once at temperature 0.
- `POST /api/summarize` (JSON: `utterances[{ seq, sourceText, translation? }]` ≤ 5000,
  `glossary, meetingContext?, outputLang`) → streamed markdown. Transcripts over ~24k
  characters are summarized in parts (two at a time) and the parts merged into one summary.
  Transcripts over 300,000 characters (well past a two-hour meeting) are rejected with `413`.

Request bodies are size-checked before they are read: oversized requests get `413`.
