# 01 — The big picture: one sentence's journey

This chapter follows one spoken sentence, "지민 님이 이번 릴리스 계획을 발표하겠습니다", from
the moment it is said to the moment its English translation appears on screen. Each step
links to the code. Later chapters zoom into each step.

## The whole pipeline in one picture

```
  🎤 microphone / tab audio
        │  MediaStream (continuous audio, 48 kHz)
        ▼
 ┌──────────────────────┐   lib/audio/vad.ts
 │ SpeechRecorder (VAD) │   Silero VAD listens to every 32 ms frame:
 │                      │   "speech?" → yes… yes… yes… no (600 ms) → cut!
 └──────────┬───────────┘
            │  Clip { audio: Float32Array @ 16 kHz, startedAt, durationMs }
            ▼
 ┌──────────────────────┐   lib/pipeline/queue.ts
 │ PipelineQueue        │   1. add an Utterance {seq: 7, status: 'transcribing'}
 │                      │      → the UI shows a shimmering placeholder
 │                      │   2. transcribe (max 2 at a time, retries)
 │                      │   3. drop made-up text (hallucination filter)
 │                      │   4. pick direction ko→en
 │                      │   5. translate, streamed (max 2 at a time)
 └──────────┬───────────┘
            │  engine.transcribe(audio) / engine.translate(request, onDelta)
            ▼
 ┌──────────────────────┐   lib/engines/server.ts   (or endpoint.ts for Custom)
 │ Engine               │   encode WAV → POST /api/transcribe
 │                      │   POST /api/translate → read the streamed text
 └──────────┬───────────┘
            ▼
 ┌──────────────────────┐   app/api/*/route.ts + lib/core/*
 │ nunchi server        │   check passcode → validate → call upstream → stream back
 └──────────┬───────────┘
            ▼
     Speaches (Whisper)   →  "지민 님이 이번 릴리스 계획을 발표하겠습니다."  (ko)
     vLLM (Qwen)          →  "Jimin" " will" " present" " the" " release" " plan."
            │
            ▼
 ┌──────────────────────┐   lib/session/store.ts → components/transcript/*
 │ Session store (state)│   every patch re-renders only that one line
 │ → React UI           │   and is saved to IndexedDB by lib/db/persist.ts
 └──────────────────────┘
```

## Step by step

### 0. Before any speech: opening a session

- The home page's **New session** button (`components/NewSessionButton.tsx:11`) navigates to
  `/session/<random-uuid>`. The id is made in the browser. There is no "create session" call
  to the server, because sessions live only on the device.
- `app/session/[id]/page.tsx` renders `SessionView`, which wraps everything in
  `SessionControllerProvider` (`components/session/controller-context.tsx:11`). That provider:
  1. loads the session from IndexedDB if it exists, or starts a fresh one
     (`lib/db/open-session.ts:13`),
  2. starts saving changes back to IndexedDB (`lib/db/persist.ts:39`),
  3. creates a `SessionController` (`lib/session/controller.ts:25`), the object that owns
     the microphone, the voice detector and the job queue.

### 1. Tap the mic: opening the audio input

`SessionController.start()` (`lib/session/controller.ts:52`):

- `openAudioInput()` (`lib/audio/sources.ts:96`) asks the browser for the microphone with
  `navigator.mediaDevices.getUserMedia(...)`, or for a browser tab's audio with
  `getDisplayMedia(...)`, or both mixed. The result is a `MediaStream`: a live, never-ending
  flow of audio.
- `SpeechRecorder.create()` (`lib/audio/vad.ts:42`) loads the **Silero VAD** model
  (~16 MB, loaded only now and cached afterwards) and attaches it to the stream.
- A **screen wake lock** keeps the phone screen on (`lib/browser/wake-lock.ts`).

### 2. Someone speaks: the VAD cuts a clip

The VAD looks at the audio in small frames (512 samples ≈ 32 ms) and gives each a
probability of being speech. When the probability crosses a threshold, "speech started".
When it stays low for 600 ms (the `redemptionMs` setting), "speech ended", and the VAD hands
over all the audio from just before the start to the end as one `Float32Array`.
`SpeechRecorder.handleSpeechEnd` (`lib/audio/vad.ts:128`) wraps it as a `Clip` and calls
`onClip`, which the controller wired to `queue.enqueue(clip)`
(`lib/session/controller.ts:70`).

If someone talks for more than 22 seconds without a pause, the recorder splits the clip at
the next quiet frame, and at 25 seconds at the latest (`lib/audio/vad.ts:136`), because
Whisper only handles 30 seconds at a time.
→ Chapter 03.

### 3. The queue creates an utterance

`PipelineQueue.enqueue` (`lib/pipeline/queue.ts:64`) gives the clip the next sequence number
(`seq`) and adds an utterance with `status: 'transcribing'` to the session store. The UI
immediately shows a shimmering placeholder whose width grows with the clip's length
(`components/transcript/UtteranceBlock.tsx:13`), so the user sees "something is coming"
right away.

### 4. Transcription

`runTranscribe` (`lib/pipeline/queue.ts:190`):

- Waits for a free slot (at most **2** transcriptions run at once).
- Builds a **Whisper prompt** from the glossary plus the end of the previous sentence
  (`lib/pipeline/whisper-prompt.ts:9`), so names like "지민" get spelled right.
- Calls `engine.transcribe(audio, { language, prompt, signal })`.

In the default **Server** mode that's `serverSpeech.transcribe`
(`lib/engines/server.ts:358`), which encodes the samples as a WAV file
(`lib/audio/wav.ts:4`) and POSTs it to `/api/transcribe`.

On the server, `app/api/transcribe/route.ts:16` checks the passcode, enforces a size limit,
decodes and validates the WAV, then calls `transcribeWithFallback`
(`lib/core/transcribe.ts:48`), which calls Speaches. If Whisper's auto-detected language
isn't Korean or English (it often mislabels short clips as Japanese), it retries once forced
to Korean. A short clip heard as English right after a Korean line is retried in Korean too,
and the more confident answer is kept.

The response looks like:

```json
{
  "text": "지민 님이 이번 릴리스 계획을 발표하겠습니다.",
  "language": "ko",
  "durationMs": 2840,
  "segments": [{ "text": "…", "noSpeechProb": 0.02, "avgLogprob": -0.21 }]
}
```

→ Chapter 04.

### 5. Filtering and direction

Back in the queue:

- `hallucinationReason` (`lib/pipeline/hallucinations.ts:43`) drops text that is empty, a
  known Whisper invention ("시청해주셔서 감사합니다", "thanks for watching"), probably not
  speech at all (by the segment scores), or a short repeat of the previous line. Dropped
  lines get `status: 'skipped'` and are hidden.
- `pickDirection` (`lib/pipeline/direction.ts:22`): in Auto mode, Korean speech is translated
  to English and English speech to Korean.
- If this line and the previous one look like one word cut in two, `rejoin` transcribes
  their audio again as one clip and splits the text where the first clip ended, fixing a word
  the cut broke (chapter 06, Part 8).
- The utterance is patched to `status: 'translating'` with its `sourceText`. The Korean text
  appears on screen.

### 6. Translation, streamed

`runTranslate` (`lib/pipeline/queue.ts:332`) builds a request with the text, the last 5
finished lines as **context**, the glossary and the meeting description, then calls
`engine.translate(request, onDelta, signal)`.

Server mode POSTs to `/api/translate`. The route (`app/api/translate/route.ts:23`) calls
`startTranslation` (`lib/core/translate.ts:26`), which builds the prompt
(`lib/prompts/translate.ts:15`) and opens a **streamed** chat completion with the LLM
(`lib/core/openai-compatible.ts:322`). The LLM sends its answer a few tokens at a time as
Server-Sent Events. The server removes any `<think>…</think>` reasoning
(`lib/core/think-stripper.ts`) and forwards plain text to the browser as it arrives
(`lib/server/http.ts:176`).

In the browser, every piece calls `onDelta` → `store.appendTranslation(id, piece)`. The
translation grows word by word with a blinking caret. If the result comes back empty or
identical to the source, the queue asks once more at temperature 0.
→ Chapters 05 and 06.

### 7. Done, and saved

The utterance becomes `status: 'done'`. The persistence subscriber notices the change and
writes it to IndexedDB in the same tick (`lib/db/persist.ts:105`); while a translation was
streaming, writes were batched once per second. Audio is never saved, only text.
→ Chapter 09.

## Timeline of one sentence

Approximate times, on good servers:

```
t=0.0s   speaker starts          VAD: speech start
t=2.8s   speaker stops
t=3.4s   600 ms of silence       VAD: speech end → clip → placeholder appears
t=3.4s   POST /api/transcribe    (WAV ≈ 90 KB)
t=4.0s   Korean text appears     Whisper took ~0.5 s
t=4.0s   POST /api/translate
t=4.3s   first English word      "time to first token" (ttft)
t=4.9s   translation complete
```

The 600 ms wait after the speaker stops is a deliberate trade-off. Waiting less cuts
sentences in half, because Korean speakers often pause mid-sentence; waiting more adds lag.
The user can tune it in Audio settings (chapter 03).

## Why this shape? The key architectural decisions

1. **Voice detection runs in the browser, not on the server.** Only speech is uploaded,
   already cut at natural pauses, so the server never processes silence, uploads stay small,
   and each request is one complete sentence for Whisper and the translator. (Inferred: this
   is the standard way to use Whisper live, since Whisper is not a streaming model. It needs
   a finished chunk of audio. See chapter 04.)
2. **One utterance = one independent job.** Jobs run in parallel (2 at a time) and may finish
   out of order, but each has a `seq` number and the UI always sorts by it. A slow line never
   blocks the next one (chapter 06).
3. **Streaming everywhere it helps.** Translations and summaries appear word by word.
   Perceived speed matters more than total time in a live tool.
4. **The browser owns the session.** No database server, no accounts: sessions live in
   IndexedDB on the device (DECISIONS.md, Phase 3). The server is a thin, stateless proxy
   that holds the secrets.
5. **Swappable engines.** Each task (speech, translation, summary) can run on this app's
   server or on a server the user enters (Custom). An in-browser option is planned. The
   pipeline doesn't know or care which (chapter 08).
6. **Failures are expected.** Phones lose network, the OS takes the mic during a call,
   servers time out. Every step has a timeout, a retry rule, and a visible recovery path
   (banners, retry buttons).

## Try it

1. With `pnpm dev:mock` running, open DevTools → Network, start a session, speak, and watch
   one `transcribe` request followed by one `translate` request per line. Click the
   `translate` request and open the **Response** tab while it streams.
2. In `lib/pipeline/queue.ts`, put `console.log('clip', clip.durationMs)` at the top of
   `enqueue`. Speak short and long sentences and see the clip lengths in the browser
   console. (Remove it afterwards.)
3. Find every place `status:` is set in `lib/pipeline/queue.ts`. Draw the state machine:
   `transcribing → translating → done`, plus `skipped` and `error`. Compare with the comments
   in `lib/types.ts:6`.
