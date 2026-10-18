# 05 — Translation and summaries with an LLM

After transcription, each line is translated by a **large language model** (Qwen, served by
vLLM), and on request the whole meeting is summarized by the same model. This chapter covers
the chat API, streaming, prompt design, the `<think>` problem, and summarizing very long
meetings.

Main files:

| File                                                       | Job                                                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `lib/core/openai-compatible.ts`                            | HTTP client: `chat.stream()`, `chat.complete()`, the SSE parser              |
| `lib/core/translate.ts`                                    | `startTranslation` / `runTranslation`: streaming plus the empty-answer retry |
| `lib/core/summarize.ts`                                    | `startSummary`: single pass or multi-part summary                            |
| `lib/core/think-stripper.ts`                               | removes `<think>…</think>` from a stream                                     |
| `lib/prompts/translate.ts`, `summarize.ts`, `glossary.ts`  | the prompt text                                                              |
| `lib/util/streams.ts`                                      | `withIdleTimeout`: fail a stream that stalls                                 |
| `app/api/translate/route.ts`, `app/api/summarize/route.ts` | the server endpoints                                                         |

---

## Part 1: The chat completions API

An LLM predicts the next token of text, over and over, the same way Whisper's decoder does
but trained on text. "Chat" models are trained to continue a conversation made of messages
with **roles**:

```http
POST {baseUrl}/chat/completions
Content-Type: application/json

{
  "model": "Qwen3-…",
  "messages": [
    { "role": "system", "content": "You are a live interpreter… Rules: …" },
    { "role": "user",   "content": "Previous lines…\n\nCURRENT line:\n번역 잘 되고 있나요?" }
  ],
  "temperature": 0.2,
  "max_tokens": 400,
  "stream": true,
  "chat_template_kwargs": { "enable_thinking": false }
}
```

- **system**: standing instructions (who you are, the rules).
- **user**: this particular request.
- **temperature**: randomness. 0 = always the most likely token. nunchi uses **0.2** for
  translations: slightly flexible wording, but stable. Retries use **0**.
- **max_tokens**: a hard cap on the answer's length. 400 tokens is plenty for one line
  (`TRANSLATE_MAX_TOKENS`, `lib/core/translate.ts:5`) and stops a runaway answer.
- **stream: true**: send the answer piece by piece instead of all at the end.

`chatBody` (`lib/core/openai-compatible.ts:303`) builds this. `config.extraBody` is merged in
last, which is how vLLM-specific fields get added without the client knowing about vLLM.

### Why a hand-written client instead of the OpenAI SDK?

The repo used the official `openai` package at first and then removed it
(DECISIONS.md, Engines Phase 2). Reasons:

- It's **fetch only**, so the **same file runs in the browser and on the server**. Custom
  endpoints call the user's server straight from the browser with exactly the code the server
  uses.
- One small file (~440 lines) the team fully controls, with errors shaped the way the
  pipeline wants (`EndpointError` with a `kind` and a `retryable` flag, Part 6).
- **No automatic retries** hidden inside a library. The job queue owns retries (chapter 06).

---

## Part 2: Streaming with Server-Sent Events (SSE)

With `stream: true`, the server keeps the HTTP response open and writes **events** as tokens
are generated:

```
data: {"choices":[{"delta":{"content":"Is"}}]}

data: {"choices":[{"delta":{"content":" the translation"}}]}

: keep-alive

data: {"choices":[{"delta":{"content":" working well?"}}]}

data: [DONE]

```

Rules of the format: each event is one or more `data:` lines followed by a **blank line**.
Lines starting with `:` are comments (keep-alives). `[DONE]` is OpenAI's end marker.

### The tricky part: the network doesn't respect event boundaries

The browser receives the body in **chunks** of arbitrary size. One chunk may hold half an
event, or three events, or end in the middle of a `\r\n`. `parseSse`
(`lib/core/openai-compatible.ts:110`) handles all of it:

```
chunk 1: 'data: {"choi'           → buffer it, no complete line yet
chunk 2: 'ces":[…]}\n\ndata: {"c' → line complete + blank line → yield event 1; buffer the rest
chunk 3: '…}\r'                   → a lone '\r' might be half of '\r\n': hold it (line 138)
```

It's an **async generator**: it `yield`s each complete payload as soon as it's known. Its
`finally` block (line 154) cancels the download if the consumer stops early. This parser is
covered by many small tests in `tests/unit/openai-compatible.test.ts`.

There's a subtle text-encoding issue here too. A Korean character is 3 bytes in UTF-8, and a
chunk boundary can split it. `decoder.decode(value, { stream: true })` (line 136) tells the
`TextDecoder` to keep an incomplete character until the next chunk. You'll see the same
`{ stream: true }` in the browser's reader (`lib/engines/server.ts:237`). Without it,
translations would sometimes show `�` characters.

### From events to text

`chat.stream()` (`openai-compatible.ts:318`) chains generators:

```
response.body (bytes)
   └─► parseSse()            → JSON strings
        └─► withIdleTimeout() → same, but fails if the stream goes silent
             └─► JSON.parse, take choices[0].delta.content, throw on {"error": …}
                  └─► yields text deltas: "Is", " the translation", " working well?"
```

Note what `stream()` returns: a **Promise that resolves once the HTTP response has started**,
with the text to come as an async iterable. That split is important for the server (Part 5).

---

## Part 3: The `<think>` problem

Qwen3 is a **reasoning model**: by default it first "thinks" inside `<think>…</think>` and only
then answers. For live translation that's wasted time and tokens. Two defenses:

1. **Turn thinking off.** vLLM accepts `chat_template_kwargs: { enable_thinking: false }`
   (`VLLM_NO_THINKING`, `openai-compatible.ts:24`). The server always sends it
   (`lib/server/llm.ts:34`), and Custom endpoints have a "Disable thinking" switch. Other
   servers ignore unknown fields.
2. **Strip it anyway.** Even with thinking off, Qwen emits an empty `<think>\n\n</think>\n\n`
   before the answer, and other models may think regardless. `ThinkStripper`
   (`lib/core/think-stripper.ts:17`) removes those spans **from a stream**.

The hard part is that a tag can be split across chunks: `'<thi'` + `'nk>'`. The stripper must
not output `'<thi'` (it might be a tag) and must not wait forever (it might just be text, like
"x <three"). `partialTagSuffix` (line 5) finds how much of the end of the buffer _could_ be
the start of a tag. Only that part is held back, and everything before it is emitted at
once:

```
push('Hello <thi')   → emits 'Hello '   holds '<thi'
push('nk>reason…')   → now inside think: drops everything, holds a possible partial '</think>'
push('</think>\n\nOK') → leaves think, trims the whitespace after it → emits 'OK'
flush()              → end of stream: emits anything held that turned out not to be a tag
```

The mock server deliberately sends `'<thi'`, `'nk>\n\n</th'`, `'ink>\n\n'` as separate chunks
(`scripts/mock-upstreams.mjs:174`), so this code is exercised in every dev session and e2e
test. The smoke test fails if `<think>` ever leaks (`scripts/smoke.mjs:69`).

---

## Part 4: Prompt design for live interpretation

`buildTranslateMessages` (`lib/prompts/translate.ts:15`) builds:

```
SYSTEM:
Meeting context: Weekly release sync for the mobile app        ← optional, user-entered
You are a live interpreter at a meeting. Translate the CURRENT line from Korean to English.

Rules:
- Output only the translation of the CURRENT line. No quotes, notes, romanization, or explanations.
- The line comes from speech recognition and may contain errors or be a fragment. …
- Use the previous lines only to resolve omitted subjects, pronouns, and terms. Do not translate them again.
- Korean often drops the subject; infer it from context, and use "we" or "I" naturally.
- Match the speaker's register: casual stays casual, formal stays polite.
- Keep numbers, product names, and code identifiers exactly as spoken.
- Always use these glossary translations:
지민 → Jimin

USER:
Previous lines (for context only):
- 안녕하세요, 오늘 회의를 시작하겠습니다. => Hello, let's start today's meeting.

CURRENT line:
지민 님이 이번 릴리스 계획을 발표하겠습니다.
```

What each part is for:

| Part                                  | Problem it solves                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Output only the translation"         | chat models like to add "Here is the translation:" or notes                                                                                                                                                  |
| "may contain errors or be a fragment" | the input is ASR output, cut at pauses, not clean text                                                                                                                                                       |
| **Previous lines (up to 5)**          | Korean drops subjects and pronouns, so "발표하겠습니다" alone doesn't say _who_ presents. Context lets the model infer it. Only lines with status `done` are used (`context()`, `lib/pipeline/queue.ts:169`) |
| "Do not translate them again"         | otherwise the model sometimes translates the context too                                                                                                                                                     |
| Register rule                         | Korean has politeness levels, and the tone should carry over                                                                                                                                                 |
| **Glossary**                          | names and jargon the model can't know. Formatted by the shared `formatGlossary` (`lib/prompts/glossary.ts`), the same one the summary uses                                                                   |
| "CURRENT line" label                  | a clear marker of what to translate. The mock server even uses it to find the text (`mock-upstreams.mjs:156`)                                                                                                |

**Prompts are code.** They live in their own folder, with tests that pin their exact wording
(`tests/unit/translate-prompt.test.ts`). DECISIONS.md Phase 0 records that refactors had to
leave the prompt text unchanged and that the prompt tests proved it. A prompt change can
silently change quality, so it should be a deliberate, reviewed edit.

---

## Part 5: The translation flow, server and browser

### `startTranslation`: open first, then stream

`lib/core/translate.ts:26`:

```ts
const upstream = await chat.stream(messages, { temperature: input.retry ? 0 : 0.2, … });
// ↑ resolves once the LLM has started answering, so connection errors throw HERE
async function* text() { … strip <think>, yield pieces … then the empty-answer retry … }
return { text: text(), abort, emptyRetry };
```

Why the split matters, in `app/api/translate/route.ts:38`:

- An HTTP response has a **status code and headers that are sent first**. Once the route
  starts streaming the body, the status is already `200` and can't change.
- So the route **awaits `startTranslation` before responding**. If the LLM is down or refuses,
  that throws, and the route returns a proper JSON error (`502`, `504`…) that the browser
  can classify and retry.
- Errors **after** streaming has started can only end the stream. `streamText`
  (`lib/server/http.ts:176`) logs them and errors the body, and the browser sees "stream was
  interrupted", which is retryable.

### Two kinds of retry, in two different places

1. **Empty answer → retry on the server.** If the stream yields nothing (the model returned
   only a think block, say), `text()` makes one **non-streamed** call at temperature 0
   (`translate.ts:55`). It happens server-side, next to the model, so no extra network trip.
2. **"Untranslated" answer → retry from the browser.** If the result equals the source text
   (the model just echoed the Korean), the queue asks again with `retry: true`
   (`lib/pipeline/queue.ts:270`), which makes the server use temperature 0. This check runs in
   the browser because it needs the **complete** translation, which only exists once the
   stream has ended on the client (DECISIONS.md Phase 0 and Phase 1).

### Reading the stream in the browser

`translateStream` → `readTextStream` (`lib/engines/server.ts:208`) reads the response body,
decodes UTF-8 incrementally, and calls `onDelta(piece)` for each piece. The queue's `onDelta`
appends to the store (`appendTranslation`), so the line grows on screen.

---

## Part 6: Timeouts for streams

A normal request timeout ("fail after 60 s") doesn't fit a stream: a healthy 2-minute summary
would be killed, and a stream that stops after one word would hang until the overall limit.
nunchi uses **two limits per stream**, implemented once in `withIdleTimeout`
(`lib/util/streams.ts:63`):

- **First piece:** allowed the call's full timeout, because the model may need time to read a
  long prompt (prompt processing).
- **Between pieces:** at most `DEFAULT_STREAM_IDLE_MS` = 30 s
  (`openai-compatible.ts:18`). A healthy stream sends tokens many times per second, so 30 s of
  silence means it has stalled (a half-open connection, a stuck server).

When a limit passes, `onTimeout` aborts the upstream request and a **retryable** timeout
error is thrown. DECISIONS.md (2026-10-17, "Stalled streams time out") explains the bug this
fixed: before, a half-open connection held one of the queue's two slots _for the rest of the
session_.

The limits are **layered**, each a backstop for the one inside it:

```
browser overall call limit (translate 150 s, summary 20 min)   lib/engines/server.ts:95
 └─ browser idle limit between pieces (90 s)                    lib/engines/server.ts:108
     └─ server streamText idle backstop (90 s)                  lib/server/http.ts:152
         └─ LLM client: 60 s to first token, 30 s between       lib/core/openai-compatible.ts
```

The innermost limit is the shortest, so it normally fires first and gives the most precise
error. The outer ones catch anything the inner ones miss.

---

## Part 7: Summarizing a whole meeting

### The input

`generateSummary` (`lib/session/use-summary.ts:24`) collects every `done` line and sends it
to the summary engine. `summaryLines` (`lib/core/summarize.ts:27`) formats each one as:

```
[12] 지민 님이 이번 릴리스 계획을 발표하겠습니다. => Jimin will present the plan for this release.
```

The model sees **both** the original and the translation. If one has an error (ASR or
translation), the other may still be right. The system prompt says so explicitly: _"expect
errors; do not invent facts"_ (`lib/prompts/summarize.ts:69`).

The output format is fixed in the prompt (`SECTIONS`, `prompts/summarize.ts:21`): Overview,
Key points, Decisions, Action items as `- [ ] owner: task`, Open questions. The UI renders it
with `react-markdown` + `remark-gfm`, so action items become checkboxes
(`components/summary/SummaryPanel.tsx:129`).

### Long meetings: map → reduce

An LLM can only read so much at once (its context window), and quality drops on very long
inputs. A two-hour meeting is about 180,000 characters (`lib/core/summarize.ts:19`). So
`startSummary` (`summarize.ts:72`) works in two stages when needed:

```
lines ──chunkLines(24,000 chars)──► [part 1] [part 2] [part 3] … [part N]
                                       │        │        │
                       summarize each part, 2 at a time, NOT streamed (800 tokens each)
                                       ▼        ▼        ▼
                                   summary1 summary2 summary3 …
                                            │
                          merge prompt: "combine partial summaries…"
                                            ▼
                               final summary, STREAMED (1,500 tokens)
```

- **Short transcript** (one chunk): one streamed call.
- **Parts are summarized in parallel, 2 at a time**, with `mapLimit`
  (`lib/util/concurrency.ts:25`), which keeps their order. Each part's prompt says _"This is
  part 2 of 5… Summarize only this part"_, so the model doesn't write a full meeting summary
  for a fragment.
- **Only the merge is streamed**, because that's what the user sees.
- **Hard cap: 300,000 characters** (`SUMMARY_MAX_CHARS`, `summarize.ts:22`), about 3 hours of
  dense talk and at most ~13 parts. Without a cap, a huge request could trigger hundreds of
  LLM calls. Both the server route and the Custom engine enforce it.
- **Summaries get 180 s per LLM call** instead of 60 s (`SUMMARY_TIMEOUT_MS`), and the browser
  allows 20 minutes overall. The merge's first token waits for all the parts.

### Superseded requests

If the user taps **Regenerate** while a summary is streaming, the old request is aborted. But
what if an engine ignores the abort and keeps sending text? `generateSummary` checks
`signal.aborted` before every UI update and before saving (`use-summary.ts:42` and `:55`), so
a stale summary can never overwrite the newer one (DECISIONS.md 2026-10-17, "Summary
generation").

## Try it

1. With `pnpm mock` running, see raw SSE:

   ```bash
   curl -N http://localhost:8787/v1/chat/completions -H 'x-mock-auth: mock-secret' \
     -H 'content-type: application/json' \
     -d '{"model":"m","stream":true,"messages":[{"role":"user","content":"CURRENT line:\n번역 잘 되고 있나요?"}]}'
   ```

   Spot the split `<think>` tags. Then call `/api/translate` on the app
   (`pnpm dev:mock`) and see clean plain text:

   ```bash
   curl -N http://localhost:3000/api/translate -H 'content-type: application/json' \
     -d '{"text":"번역 잘 되고 있나요?","sourceLang":"ko","targetLang":"en"}'
   ```

2. Read `tests/unit/think-stripper.test.ts` and write one more case: a chunk that ends with
   `'</thi'` while inside a think block.
3. In `lib/prompts/summarize.ts`, call `chunkLines` mentally with a `maxChars` of 50 and five
   20-character lines. How many chunks do you get? Check with a quick unit test.
4. Find all three places the number `0.2` appears as a temperature, and the places where `0`
   is used instead. Explain each.
