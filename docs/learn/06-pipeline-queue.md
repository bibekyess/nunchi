# 06 — The job queue: concurrency, ordering, retries, cancellation

`lib/pipeline/queue.ts` (`PipelineQueue`) is the heart of the live pipeline. Every clip the
VAD produces becomes a **job**: transcribe → filter → choose direction → translate. This
chapter explains how jobs run in parallel without chaos, survive bad networks, and stop
cleanly.

It's about 450 lines, and it's worth reading in full after this chapter.

---

## Part 1: The data flow

```
            enqueue(clip)
                │
                ▼
   ┌─────────────────────────┐  addUtterance({ seq: 7, status: 'transcribing' })
   │ store: new utterance    │  clips.set(id, clip)          ← audio kept in memory only
   └───────────┬─────────────┘
               ▼
        runTranscribe(id) ──── waits for transcribeSlots (2) ───► engine.transcribe
               │                                                   (retries 1 s, 3 s)
               ├─ dropped by filter ──► status 'skipped'
               ├─ cut mid-sentence? ──► rejoin with the previous line (Part 8)
               ▼
        status 'translating', sourceText set; clips.delete(id)     ← audio no longer needed
               ▼
        runTranslate(id) ───── waits for translateSlots (2) ────► engine.translate (stream)
               │                                                   onDelta → appendTranslation
               ├─ empty / echo ──► once more with retry: true
               ▼
        status 'done'                         (any failure ─► status 'error' + message)
```

### State lives in the store, not in the queue

The queue doesn't keep its own list of utterances. It reads and writes the **session
store** through `deps.getState()`. Why?

- There's **one source of truth**. The UI renders from the store, persistence saves from
  the store, and the queue updates the store. Nothing gets out of sync.
- After a reload, the session's saved lines are loaded into the store, and a new queue just
  continues from them: `nextSeq` starts after the last saved `seq` (`queue.ts:56`).

The only thing the queue keeps privately is **audio** (`clips`, line 39) and the abort
controllers of running jobs (`jobs`, line 41). Audio is never stored in the state or the
database. It's kept just long enough to retry a failed transcription and released as soon as
transcription succeeds (line 234), except the latest line's clip, kept for a rejoin (Part 8).

---

## Part 2: Concurrency: why "2 at a time"

```ts
export const CONCURRENCY = 2;                                   // queue.ts:12
private readonly transcribeSlots = new Semaphore(CONCURRENCY);  // queue.ts:48
private readonly translateSlots  = new Semaphore(CONCURRENCY);
```

A **semaphore** is a counter of free slots. `slots.run(task)` starts the task if a slot is
free, otherwise it waits in line.

**Why not 1?** With one at a time, a slow request (a 2-second Whisper call, a long
translation) delays every following line. Two lets the next line start while the previous
one finishes.

**Why not unlimited?** If the network drops for 30 seconds and 15 clips pile up, unlimited
concurrency would fire 15 requests at once when it returns, competing for the same GPU and
making _every_ line slow. A small fixed number keeps the latency of each line predictable.
(This reasoning is inferred, not written down.)

**Why separate pools for transcription and translation?** They hit different servers
(Speaches vs vLLM). A burst of translations shouldn't block new transcriptions, and the
reverse.

### The FIFO semaphore

`lib/util/concurrency.ts:6`:

```ts
async run<T>(task: () => Promise<T>): Promise<T> {
  if (this.active < this.size) this.active++;
  else await new Promise<void>((r) => this.waiting.push(r)); // the slot arrives already counted
  try { return await task(); }
  finally {
    const next = this.waiting.shift();
    if (next) next();          // hand MY slot directly to the next waiter
    else this.active--;
  }
}
```

The subtle part is **handing the slot over** instead of freeing it. An earlier version did
`active--` and then woke a waiter. Between those two moments, a newly arriving task could see
a free slot and take it, so the waiter _and_ the newcomer both ran, three at once, with the
newcomer jumping the queue. DECISIONS.md (2026-10-17, "Semaphore") records the fix.
`tests/unit/concurrency.test.ts` reproduces the race.

---

## Part 3: Ordering: out-of-order completion, in-order display

Two jobs run in parallel, so line 8 can finish before line 7. That's fine, because:

- every utterance gets a `seq` number **when the clip arrives** (`queue.ts:72`), in speech
  order,
- the store keeps `ids` sorted by `seq` (`addUtterance`, `lib/session/store.ts:175`),
- the UI renders `ids` in order, and each line fills in whenever its job finishes.

On screen you might see line 8's text appear while line 7 still shimmers. The order is
always right. The e2e test checks it: `expect(seqs).toEqual([...seqs].sort(...))`
(`tests/e2e/session.spec.ts`).

---

## Part 4: Retries

### What is worth retrying?

Errors carry a **kind** and a **retryable** flag (`lib/errors.ts:8`):

| Kind          | Retryable | Examples                                           |
| ------------- | --------- | -------------------------------------------------- |
| `network`     | yes       | Wi-Fi dropped, connection reset, stream broke off  |
| `timeout`     | yes       | server too slow, stream stalled                    |
| `upstream`    | yes       | 5xx from the model server, 429 "too many requests" |
| `auth`        | no        | wrong passcode or API key: retrying won't help     |
| `bad_request` | no        | invalid input: retrying gives the same answer      |
| `unavailable` | no        | engine not set up / not built                      |

The queue doesn't look at HTTP status codes. It only asks `err.retryable`. The engine that
made the request decides how to classify its failures. That keeps the queue independent of
the transport (HTTP today, a Web Worker tomorrow).

### `withRetries`

`queue.ts:135`:

```ts
for (let i = 0; ; i++) {
  if (engine.needsNetwork) await this.deps.waitForOnline(signal); // ① wait out offline periods
  try {
    return await attempt();
  } catch (err) {
    const retryable = err instanceof EngineError && err.retryable;
    if (!retryable || i >= BACKOFF_MS.length || signal.aborted) throw err; // ② give up
    await this.deps.sleep(BACKOFF_MS[i]); // ③ back off: 1 s, then 3 s
  }
}
```

1. **Offline-aware.** Before each attempt, if the engine needs the network, wait until the
   browser is online. A clip recorded in a subway tunnel waits instead of burning its
   retries. On-device engines and Custom endpoints on `localhost` have
   `needsNetwork: false` and run immediately (chapter 08).
2. **Bounded.** Three attempts in total. After that the line shows an error with a retry
   button.
3. **Backoff.** Waiting 1 s, then 3 s, gives a struggling server room to recover instead of
   hammering it.

**Only the queue retries.** The server's LLM client has _no_ automatic retries
(`lib/server/llm.ts:17`: _"translations are latency-sensitive; the browser's job queue owns
retries"_). If both layers retried, one failure could become 3 × 3 = 9 requests.

### Manual retries

- `retry(id)` (`queue.ts:84`) restarts a failed line **from where it failed**: if the audio is
  still in memory, re-transcribe; else if the text exists, re-translate only.
- `retryAllFailed()` backs the "Retry all failed" banner. Retries use whatever engine is
  chosen _at retry time_, so switching to a working engine and pressing "Retry all" recovers a
  session (DECISIONS.md, Engines Phase 2).
- After a passcode is entered, the banner calls `retryAllFailed()` automatically
  (`components/session/Banners.tsx:136`).

---

## Part 5: Bounded memory: the 50-clip cap

Offline, clips accumulate in memory. At 16 kHz, 50 clips of a few seconds each are roughly
15 MB (`MAX_PENDING_CLIPS`, `queue.ts:15`). Past the cap, `evictOldClips` (`queue.ts:156`)
drops the oldest: its audio is released, **its job is aborted**, and its line shows
"Dropped: too many clips waiting for the network".

Two details from the hardening pass (DECISIONS.md 2026-10-17, "Dropped clips are really
dropped"):

- Each job has its **own** `AbortController` (`queue.ts:200`), combined with the queue-wide
  one by `AbortSignal.any`. Evicting a clip cancels exactly that job.
- The job doesn't hold the audio while waiting. It calls `audio()` (`queue.ts:204`) at the
  moment it sends. A dropped clip is really freed, and a dropped line is never transcribed
  later when the network returns.

---

## Part 6: Cancellation and disposal

When the user leaves the session page, everything must stop: no more requests, and no more
writes to a store that now shows a different session.

- `dispose()` (`queue.ts:106`) aborts the queue's controller. Every running job's signal is
  derived from it, so every `fetch` is cancelled.
- `patch()` and `fail()` check `this.signal.aborted` first (`queue.ts:118-129`), so a late
  answer arriving after dispose is ignored.
- `enqueue()` returns early once disposed (`queue.ts:66`), because the recorder can still
  deliver a final clip while it is being torn down.
- `fail()` ignores `AbortError`: a cancellation is not a failure and shouldn't show an error.

This pattern — check whether you were cancelled after every `await` — runs through the whole
codebase. An `await` is a point where _anything_ may have changed. The `SessionController`
does the same with a `disposed` flag (`lib/session/controller.ts:61`, `:77`, `:84`, `:87`):
if you leave while the browser is still asking for mic permission, the mic is closed again as
soon as it opens (DECISIONS.md 2026-10-17, "Leaving mid-start closes the mic").

---

## Part 7: Dependency injection makes it testable

The constructor takes everything from outside (`QueueDeps`, `queue.ts:17`):

```ts
export interface QueueDeps {
  getState: () => SessionState;
  engines: () => Pick<Engines, 'speech' | 'translate'>; // read PER JOB
  newId: () => string;
  sleep: (ms: number) => Promise<void>;
  waitForOnline: (signal?: AbortSignal) => Promise<void>;
}
```

The real wiring is in `SessionController`'s constructor (`lib/session/controller.ts:38`):
`crypto.randomUUID`, a real `setTimeout` sleep, the real engines. The tests
(`tests/unit/queue.test.ts`) pass fakes instead:

- `sleep: vi.fn(async () => {})`: retries happen instantly, so tests stay fast.
- fake engines whose `transcribe` returns a **deferred** promise the test resolves whenever it
  wants, which makes "line 8 finishes before line 7" easy to reproduce.
- `waitForOnline` that never resolves, to simulate being offline.

`engines` is a **function**, called for each job (`queue.ts:211`, `:403`). Change the engine
in Processing settings mid-meeting and the very next line uses the new one (DECISIONS.md,
Engines Phase 1).

## Part 8: Rejoining a line cut mid-word

The VAD ends a line after 600 ms of quiet, and people pause mid-sentence. When a pause falls
inside a word, Whisper mishears both halves:

```
heard:   "I went to hoss"   │ "petal for checkup"
fixed:   "I went to hospital" │ "for checkup"
```

`rejoin` (in `runTranscribe`) fixes this with the audio, not by guessing from the text. When
`shouldRejoin` (`lib/pipeline/rejoin.ts`) says the new line probably continues the previous
one (same language, at most a 700 ms audio gap, together at most 25 s, and the previous line
doesn't end like a sentence), the queue:

1. **Joins the two clips** (`joinAudio`), with up to 150 ms of silence between them. To make
   this possible, the queue keeps the latest line's clip (`recent`) after transcription.
2. **Transcribes them again as one clip, with word timings** (`words: true`). Timings are
   slower to compute, so only this call asks for them.
3. **Splits the text where the first clip ended** (`splitAtBoundary`). Each word goes to the
   half its middle falls in, and Whisper's own spacing and punctuation are kept.
4. **Revises the previous line** (`revise`). Its new translation is done out of sight, and
   the text and translation are swapped in together, so the row changes once (with a fade).
   A translation still streaming for it is cancelled first (`beginTranslation`).

The new line waits on its shimmer during the second call, so it simply appears correct.
Without word timings (some servers don't send them), the two lines merge into one and the
new line becomes `skipped`. Any failure, or timings that don't fit the text, keeps both lines
as heard. Each line changes at most once: a line is revised only once (`revised`), and a line
split off by a rejoin never becomes `recent`, because its audio still starts with the tail of
the cut word.

## Try it

1. Read `tests/unit/queue.test.ts` and list every behavior it tests (each `it(...)`). Compare
   with the sections of this chapter.
2. In DevTools → Network, set throttling to **Offline**, speak a few lines, then go back
   **Online**. Watch the queued requests fire, at most two at a time.
3. Change `CONCURRENCY` to `1` and speak several short lines quickly. Notice the lag build up.
   Put it back.
4. Explain why `runTranscribe` reads `this.deps.getState().session?.mode ?? mode` again after
   transcription (`queue.ts:247`) instead of reusing the `mode` from the start of the job.
   (Hint: what can the user change while a job is waiting?)
