# 11 — Testing and tooling

The repo has three layers of automated tests, a fake model server, a smoke script, and CI
that runs everything on every push. This chapter explains what each layer is for, so you
know which kind of test to write for a change.

---

## Part 1: The testing pyramid

```
            ▲  slower, more realistic, fewer tests
           ╱ ╲
          ╱e2e╲        tests/e2e/          Playwright: real Chromium + real built app + mock models
         ╱─────╲                           (fake microphone playing a WAV file)
        ╱ integ. ╲     tests/integration/  API route handlers called directly, upstreams faked with MSW
       ╱───────────╲
      ╱    unit     ╲  tests/unit/         one module at a time, with fakes for its dependencies
     ╱───────────────╲
            ▼  faster, more focused, many tests
```

| Command      | Runs                                     | Speed         |
| ------------ | ---------------------------------------- | ------------- |
| `pnpm test`  | unit + integration (Vitest)              | seconds       |
| `pnpm e2e`   | e2e (Playwright); run `pnpm build` first | a few minutes |
| `pnpm smoke` | a script against a running server        | seconds       |

---

## Part 2: Unit tests (`tests/unit/`)

There's roughly one test file per module: `queue.test.ts` for `lib/pipeline/queue.ts`,
`think-stripper.test.ts` for the stripper, and so on. They run in Node (`vitest.config.mts`),
not a browser.

What makes this code easy to unit test is that **dependencies are passed in** rather than
imported and called directly (chapter 12):

| Module                   | Injected dependency                                | What the test passes                                   |
| ------------------------ | -------------------------------------------------- | ------------------------------------------------------ |
| `PipelineQueue`          | `QueueDeps` (engines, sleep, waitForOnline, newId) | fake engines with controllable promises, instant sleep |
| `createOpenAICompatible` | `config.fetch`                                     | a fake fetch, or MSW                                   |
| `persistSession`         | `save`, `now`                                      | a recording fake, a fixed clock                        |
| `openSession`            | `load`                                             | a loader that throws, to simulate blocked storage      |
| `checkEndpoint`          | `fetch`, `pageProtocol`                            | fakes for CORS / mixed-content cases                   |
| `canCaptureTabAudio`     | `nav`                                              | fake `navigator` objects                               |

**Deferred promises** are the key trick for async code (`tests/unit/queue.test.ts:9`):

```ts
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
```

A fake engine returns `d.promise`, and the test calls `d.resolve(...)` exactly when it wants.
That's how tests reproduce "line 2 finishes before line 1" or "the user leaves while the mic
is opening" deterministically, with no real timers and no flakiness.

Other tools in use:

- `vi.fn()`: a fake function that records its calls (`expect(fn).toHaveBeenCalledTimes(3)`).
- `vi.stubEnv()`: set environment variables for one test.
- `fake-indexeddb`: a complete in-memory IndexedDB, so `tests/unit/db.test.ts` tests the real
  Dexie code, including the v1 → v2 upgrade.
- `tests/server-only-stub.ts`: `server-only` throws outside Next's server environment, so the
  Vitest config aliases it to an empty module (`vitest.config.mts:9`).

**A rule from the hardening pass:** DECISIONS.md 2026-10-17: _"Each fix below has a test that
fails on the code before it."_ A bug fix comes with a test that proves the bug existed.

---

## Part 3: Integration tests (`tests/integration/`)

These call the **route handlers themselves**: `import { POST } from '@/app/api/translate/route'`,
then `await POST(new Request(...))`. That exercises validation, auth, the core logic, the
OpenAI client and streaming together, without starting a server.

The upstream model servers are faked with **MSW** (Mock Service Worker), which intercepts
`fetch` calls in Node:

```ts
server.use(
  http.post(`${LLM}/chat/completions`, async ({ request }) => {
    upstream = await request.json(); // capture what we sent
    header = request.headers.get('x-gpu-key');
    return chatStream(['<thi', 'nk>\n\n</think>', '\n\nIs the ', 'translation ', 'working well?']);
  }),
);
const res = await POST(request(body));
expect(await res.text()).toBe('Is the translation working well?');
```

(`tests/integration/translate.test.ts`.) The test can check both sides: what the route
_sends_ to the LLM (headers, `chat_template_kwargs`, the prompt) and what it _returns_ to the
browser. `onUnhandledFrame: 'error'` makes any request without a handler fail the test, so
nothing silently reaches the real internet.

`helpers.ts` has builders for SSE streams (`chatStream`), JSON answers and WAV blobs of exact
sizes (for the size-limit tests).

---

## Part 4: End-to-end tests (`tests/e2e/`)

Playwright drives a **real Chromium** against the **production build**. The config
(`playwright.config.ts`) starts three servers:

1. the mock model server on port 8788,
2. the app on 3100, pointed at the mock (Server mode),
3. a second app on 3101 with **no upstreams at all**, to prove Custom mode works without the
   app server's models (`custom-endpoint.spec.ts`).

The trick that makes it possible to test a speech app automatically is in the Chromium flags:

```ts
'--use-fake-ui-for-media-stream',                      // auto-accept the mic permission prompt
'--use-fake-device-for-media-stream',                  // a fake mic…
'--use-file-for-fake-audio-capture=tests/fixtures/speech-en.wav',  // …that plays this file
```

So the real VAD hears real speech (the public-domain JFK clip from whisper.cpp), cuts real
clips and sends them through the whole pipeline. The device profile is a Pixel 7, so the
phone layout is tested.

`session.spec.ts` walks through a whole session: start → lines appear in order → no `<think>`
leaks → the view filter, text size and layout work → reload and check recovery → the summary
streams → the session shows on the home page.

Tests find elements the way a user does: `getByRole('button', { name: 'Start listening' })`,
plus a few `data-testid` and `data-status`/`data-seq` attributes. Role-based selectors double
as an accessibility check: if a test can't find the button by its name, a screen reader can't
either.

---

## Part 5: The mock model server

`scripts/mock-upstreams.mjs` is a ~200-line Node HTTP server that pretends to be both Speaches
and vLLM. DECISIONS.md Phase 0: _"this build environment cannot reach the GPU hosts"_, so
everything was built against this mock. It:

- answers `/v1/models`, `/v1/audio/transcriptions` (canned Korean or English sentences) and
  `/v1/chat/completions` (canned translations, or a canned markdown summary when the system
  prompt mentions summaries),
- streams in **real SSE format** and deliberately **splits the `<think>` tags across chunks**,
- **requires a custom header** for chat when `MOCK_HEADER_NAME/VALUE` are set, like the real
  LLM gateway, so auth handling is tested,
- answers **CORS preflights**, so the browser can use it as a Custom endpoint,
- adds `MOCK_LATENCY_MS` of delay (150 ms by default), so loading states are visible.

`pnpm dev:mock` (`scripts/dev-mock.mjs`) starts `next dev` with `.env.mock` loaded. The comment
explains why it uses `process.loadEnvFile` instead of `node --env-file`.

**`pnpm smoke`** (`scripts/smoke.mjs`) is a quick end-to-end check of a _running_ server, and is
also useful against the real servers: health → transcribe a WAV → stream its translation,
printing timings, and failing if a `<think>` block leaks. Run it after deploying.

---

## Part 6: Static checks and CI

| Tool       | Command             | Catches                                                                                                                                      |
| ---------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript | `pnpm typecheck`    | wrong types, missing fields, typos in unions. `next typegen` first generates route types (e.g. `LayoutProps`)                                |
| ESLint     | `pnpm lint`         | bugs, React hook mistakes, and the **portable-imports layering rule** (chapter 08)                                                           |
| Prettier   | `pnpm format:check` | inconsistent formatting. `PLAN.md` is in `.prettierignore`: it's the owner's working copy and must not be reformatted (DECISIONS.md Phase 2) |

`.github/workflows/ci.yml` runs three jobs on every push and pull request:

1. **checks**: format, lint, typecheck, unit + integration tests, build,
2. **e2e**: build + Playwright, and on failure uploads the screenshots and report,
3. **docker**: the image must build.

`concurrency: cancel-in-progress` stops an old run when you push again.

---

## Part 7: Deployment

**Docker** (`Dockerfile`), a multi-stage build:

1. **deps**: `pnpm install --frozen-lockfile` (exact versions from the lockfile). The
   postinstall script copies the VAD model and WASM into `public/vad/`.
2. **build**: `pnpm build` with `output: 'standalone'` (`next.config.ts:39`), which produces
   a minimal self-contained server in `.next/standalone`.
3. **runner**: only the standalone server, static files and `public/`, running as a non-root
   user, with a `HEALTHCHECK` on `/api/live`.

The final image contains no source code, dev dependencies or secrets. **Secrets are read at
container start** from `.env.local` (`docker-compose.yaml`: `env_file`), never baked into the
image, which is why the build must work without them (chapter 07).

The container listens on `127.0.0.1:9083` only. An **HTTPS reverse proxy** (nginx) goes in
front, because browsers only allow the microphone over HTTPS. The README has a complete nginx
example with rate limiting, request ids, streaming (`proxy_buffering off`) and long timeouts
for summaries.

## Try it

1. Run `pnpm test`. Then break something on purpose: change `BACKOFF_MS` in
   `lib/pipeline/queue.ts` to `[1000]` and see which test fails and why. Revert it.
2. Write a unit test for `formatElapsed` (`lib/display/format.ts`) with a value over one hour,
   and check it against the existing `tests/unit/format.test.ts`.
3. Run `pnpm build && pnpm e2e`, then open `test-results/session-listening.png`.
4. Run `pnpm mock` with `MOCK_LATENCY_MS=3000` and use the app. Watch the placeholders, the
   caret and the "Hearing speech…" status with slow servers.
