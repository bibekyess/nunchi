# 07 — The server side

The nunchi server is a thin layer between the browser and the GPU servers. It has four API
routes and very little state. That thinness is deliberate. This chapter explains what the
server _does_ own: secrets, validation, limits, error shaping, logging and security headers.

Files: `app/api/*/route.ts`, `lib/server/*`, `lib/api/*`, `instrumentation.ts`,
`next.config.ts`.

---

## Part 1: Why have a server at all?

The browser could call Speaches and vLLM directly (that's what Custom mode does). In Server
mode it doesn't, because:

1. **Secrets.** The GPU servers need credentials (`LLM_HEADER_VALUE`, `LLM_API_KEY`,
   `SPEACHES_API_KEY`). Anything sent to the browser can be read by anyone, so these must stay
   on a server.
2. **Control.** The server validates input, caps sizes, and can protect the GPUs with a
   passcode (`APP_ACCESS_TOKEN`).
3. **CORS.** The browser blocks calls to other domains unless they opt in. Calling our own
   origin (`/api/...`) avoids that entirely.

And what it deliberately does **not** do: store sessions, keep user accounts, or forward
requests to user-entered URLs. ENGINES-PLAN.md 2.2: _"the Next.js server never forwards
user-entered URLs (that would be an open proxy / SSRF)"_. If the server fetched any URL a user
typed, an attacker could make it request internal addresses on its network. That's why
Custom endpoints are called from the browser instead.

---

## Part 2: Anatomy of a route

Every route has the same shape. `app/api/translate/route.ts:23`, simplified:

```ts
export const POST = withRequestLog('translate', async (request, log) => {   // ① logging + request id
  try {
    const denied = checkAccess(request);           // ② passcode
    if (denied) return denied;
    if (!isConfigured('llm')) return notConfigured('llm');   // ③ upstream present?

    const { data, error } = await parseJsonBody(request, translateBodySchema, MAX_BODY_BYTES); // ④ validate + size cap
    if (error) return error;

    const run = await startTranslation(serverChat, data, request.signal);  // ⑤ core logic, cancellable
    return streamText({ log, text: run.text, abort: run.abort, … });      // ⑥ stream the answer
  } catch (err) {
    log.done('error');
    return errorResponse(log, err);                // ⑦ safe JSON error
  }
});
```

The route itself contains **no business logic**. DECISIONS.md (Engines Phase 0): _"Routes are
thin: access check, parseJsonBody, core call, streamText."_ The logic lives in `lib/core/`, so
the browser can run the same code for Custom endpoints. Shared steps live in `lib/server/http.ts`.

---

## Part 3: The pieces

### ① Configuration: `lib/server/env.ts`

Environment variables (from `.env.local` or Docker's `env_file`) are validated with a **zod
schema** (`envSchema`, line 16):

- URLs must be URLs; empty strings become `undefined`; trailing slashes are removed.
- **Cross-field rules** with `.refine`: `LLM_BASE_URL` and `LLM_MODEL` must be set _together_,
  and so must the header name and value.
- Each upstream is **optional**. A deployment can leave speech or the LLM to Custom
  endpoints, and its routes answer `503 not_configured`, which the UI shows as "not set up"
  rather than as an error (DECISIONS.md, Engines Phase 1).

**Lazy parsing.** `getEnv()` (line 62) parses on first use and caches the result. `next build`
imports the route files but never calls them, so the build works **without any secrets**
(DECISIONS.md Phase 0). That makes CI and Docker builds simpler and safer.

**Fail fast at boot.** `instrumentation.ts` runs once when the server starts and calls
`runBootCheck()` (`lib/server/boot.ts:25`). An invalid environment prints a clear list of
problems and **exits the process**. Without it, Next.js would log the error and keep serving
`500` on every request: a broken deployment that looks alive. It also warns when a production
server has upstreams but no passcode. The check is skipped during the build
(`NEXT_PHASE`), and `process.exit` sits in `boot.ts`, not `instrumentation.ts`, so the edge
build of that file doesn't warn about it (see the comment in `boot.ts:21` and commit
`646203d`).

### ② The passcode: `lib/server/auth.ts`

If `APP_ACCESS_TOKEN` is set, every `/api/*` request (except `/api/live` and `/api/unlock`)
must send an `x-nunchi-token` header. `checkAccess` (line 48) accepts two things there:

- **A token from `/api/unlock`** (what the browser sends). `POST /api/unlock` takes
  `{ "passcode": "…" }` and returns `{ token, expiresAt }`. The token is
  `<expiresAt>.<signature>`, where the signature is an HMAC-SHA256 of the expiry time keyed
  with the passcode (`issueToken`, line 23). `verifyToken` (line 29) recomputes the signature
  and checks the expiry; it is valid for 7 days (`TOKEN_TTL_MS`).
- **The passcode itself**, so scripts like `scripts/smoke.mjs` keep working.

Why a token instead of storing the passcode? Whatever the browser stores is what it sends, so
hashing or encrypting the passcode in the browser wouldn't help: the hash would just become
the new passcode. The token is different: someone who reads `localStorage` on a shared
computer can't learn the passcode from it, and it stops working after 7 days. It is
**stateless**: the server keeps no list of tokens. Because the signature is keyed with the
passcode, changing `APP_ACCESS_TOKEN` revokes every token at once. Checking an HMAC costs a
few microseconds, nothing next to a network round trip.

Every comparison uses `crypto.timingSafeEqual` (`sameText`, line 10). A normal `===` stops
at the first differing character, so an attacker measuring response times could guess the
secret one character at a time. A constant-time comparison closes that leak.

In the browser, a `401` turns into an `EngineError` with `kind: 'auth'` and
`engine: 'server'`. Its `needsPasscode` getter (`lib/errors.ts:35`) makes the session show an
inline passcode field. `unlockServer()` trades the passcode for a token, and only the token
is stored in `localStorage` and sent with every call (`lib/engines/server.ts:55`). An expired
token gets a `401` like a missing one, so the field simply shows again. Only the **server**
engine's auth errors ask for the passcode.
A Custom endpoint refusing its key says "check the API key in Processing settings" instead
(`lib/engines/endpoint.ts:82`).

The nginx example in the README adds **rate limiting** at the proxy, which slows down
guessing the passcode. Doing that in the app is left to the proxy on purpose.

### ③ ④ Validation and size limits: `lib/server/http.ts`

`readBodyLimited` (line 91) reads a request body **with a cap**:

1. If the `Content-Length` header already says it's too big → refuse without reading.
2. Otherwise read chunk by chunk and stop as soon as the total passes the cap. (The header can
   lie or be missing.)

Without it, one huge request could fill the server's memory. Caps per route: 2 MB + 64 KB for
audio, 1 MB for a translation, 2 MB for a summary, each with a comment explaining the number.

`parseJsonBody` (line 124) then parses the JSON and validates it with a zod schema from
`lib/api/contract.ts`, returning either typed data or a ready-made `400`/`413` response.

### The shared contract: `lib/api/contract.ts`

Paths, request schemas and response schemas live in **one file imported by both sides**:

- the server validates requests with `translateBodySchema`,
- the browser validates _responses_ with `transcriptionResultSchema` and `healthStatusSchema`
  (`lib/engines/server.ts:160`), so an unexpected answer (say, from a newer server version)
  fails right there with a clear message instead of causing odd bugs later,
- `satisfies z.ZodType<TranslateRequest>` (line 40) ties each schema to the TypeScript
  interface the engines use. If they drift apart, compilation fails.

### ⑥ Streaming responses: `streamText`

`streamText` (`http.ts:176`) turns an async iterable of strings into a streaming HTTP
response:

- creates a `ReadableStream` that pulls from the text iterator and encodes each piece to
  bytes,
- measures **time to first token** (`ttftMs`) on the first piece,
- applies an idle-timeout backstop (chapter 05),
- `cancel()` runs when the browser disconnects → `abort()` stops the upstream LLM request, so
  the GPU stops working for nobody,
- logs exactly **one** summary line when the stream ends: `ok`, `aborted` or `error`.

Headers: `text/plain; charset=utf-8` and `Cache-Control: no-store`. The README's nginx
example sets `proxy_buffering off` so the proxy doesn't hold the stream back until it ends.

### ⑦ Errors that are safe to show

There are two audiences for an error: the **user** and the **operator**. They need different
information, and the user must never see secrets.

- `UpstreamError` (`http.ts:55`) holds a `detail` (the upstream's raw response body) that is
  **logged only**, never sent to the client.
- `errorResponse` (`http.ts:282`) maps anything thrown to a fixed JSON shape,
  `{ error: { code, message } }`, with a status from one table (`STATUS`, line 20). Unknown
  errors become a generic `500 internal_error`.
- **Redaction.** An upstream may echo the request's auth header in its error body.
  `redactSecrets` (line 245) replaces this server's own credentials with `[redacted]` before
  anything is logged, and log fields whose _name_ looks like a secret (`token`, `api_key`…)
  are dropped entirely (`lib/server/log.ts:22`).

### ① Logging: `lib/server/log.ts`

The server writes **one line per request** with timings and sizes, and never transcript or
prompt text (privacy):

```
[translate] ok open=120ms ttft=380ms dir=ko->en out=214ch total=1902ms rid=3f2a…
```

| Field   | Meaning                                                                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `open`  | time until the LLM stream opened                                                                                                               |
| `ttft`  | time to first token: what the user feels as "lag"                                                                                              |
| `dir`   | translation direction                                                                                                                          |
| `out`   | characters sent                                                                                                                                |
| `total` | whole request                                                                                                                                  |
| `rid`   | request id (from the proxy's `X-Request-ID`, or a new UUID), also sent back as `x-request-id`, so a user's report can be matched to a log line |

In production the same data is written as **JSON lines** for log collectors. `LOG_FORMAT` and
`LOG_LEVEL` override the defaults.

Design notes (DECISIONS.md 2026-10-18, "Server logs"):

- **A small logger of its own**, no dependency: about 180 lines covers everything needed.
- **Explicit logger, not AsyncLocalStorage.** `withRequestLog` (line 164) creates a logger per
  request and _passes it as an argument_. Some frameworks keep "the current request" in hidden
  global context, which is convenient but easy to lose across streams and harder to test.
  Passing it explicitly is plain and visible.
- Naming convention: numbers end in `Ms`, `Chars` or `Kb`, and the pretty printer turns them
  into `ms`, `ch`, `KB`.

### Health checks: two different questions

- `GET /api/health`: **are the upstreams working?** Pings Speaches and the LLM in parallel
  (`GET /models`, 5 s timeout), passcode-protected. The UI's status badge uses it.
- `POST /api/unlock`: **trade the passcode for a token.** The only route that takes the
  passcode in its body instead of a header; see ② above.
- `GET /api/live`: **is this process alive?** No passcode, no upstream calls. Docker's
  `HEALTHCHECK` uses it (`Dockerfile:35`). If the container restarted every time a GPU server
  went down, that would make things worse, so liveness must not depend on upstreams.

---

## Part 4: Security headers: `next.config.ts`

Every response carries headers that limit what a compromised or tricked page can do:

| Header                                                          | Effect                                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `Content-Security-Policy`                                       | which scripts/styles/connections are allowed (below)                    |
| `Permissions-Policy: microphone=(self), display-capture=(self)` | only this site (not embedded frames) can use the mic and screen capture |
| `X-Frame-Options: DENY` + `frame-ancestors 'none'`              | the app can't be embedded in another site (clickjacking)                |
| `X-Content-Type-Options: nosniff`                               | browsers must trust the declared content type                           |
| `Referrer-Policy`                                               | don't leak full URLs to other sites                                     |

The CSP (`next.config.ts:12`) is a set of trade-offs, each explained in its comment:

- `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`: no scripts from other domains.
  Inline scripts are allowed because a nonce-based CSP would force every page to render per
  request. `'wasm-unsafe-eval'` is needed to run the VAD's WebAssembly.
- `worker-src 'self' blob:`: ONNX Runtime starts workers from blob URLs.
- `connect-src 'self' https: http:`: **must stay open**, because Custom endpoints can be any
  URL the user enters.

HSTS and rate limiting are left to the HTTPS proxy, which terminates TLS (README, "Docker").

## Try it

1. Start `pnpm dev:mock` with `APP_ACCESS_TOKEN=abc` added to `.env.mock` (temporarily). Call
   `curl -i localhost:3000/api/health`, then with `-H 'x-nunchi-token: abc'`. Compare the
   status codes and the `x-request-id` header. Then get a token with
   `curl -s localhost:3000/api/unlock -H 'Content-Type: application/json' -d '{"passcode":"abc"}'`
   and send _that_ as `x-nunchi-token`. Change one digit of the expiry and try again.
2. Send a 3 MB file to `/api/transcribe` and read the `413`. Which line refused it?
3. Set `LLM_MODEL=` (empty) but keep `LLM_BASE_URL` in an env file and start the server. Read
   the boot error and find the `.refine` that produced it.
4. Read `tests/integration/request-limits.test.ts`: it has one test for a body whose
   `Content-Length` declares it too big, and one for a streamed body with no length at all.
   Why are both needed?
