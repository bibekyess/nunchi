# 04 — How speech recognition works (and how nunchi uses it)

This chapter explains automatic speech recognition (ASR) with Whisper: what happens inside
the model, what the HTTP API looks like, and the tricks nunchi uses to get good Korean
transcripts out of it.

Main files:

| File                             | Job                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `lib/core/openai-compatible.ts`  | the HTTP client: `speech.transcribe()` and `parseTranscription()`            |
| `lib/core/transcribe.ts`         | `transcribeWithFallback`: retry as Korean when language detection goes wrong |
| `lib/server/speaches.ts`         | the server's Speaches model (adds config and error mapping)                  |
| `app/api/transcribe/route.ts`    | the `/api/transcribe` endpoint                                               |
| `lib/pipeline/whisper-prompt.ts` | builds the prompt that helps Whisper spell names                             |
| `lib/pipeline/hallucinations.ts` | drops text Whisper made up                                                   |
| `lib/languages.ts`               | supported languages and normalizing Whisper's language names                 |

---

## Part 1: What is inside Whisper

Whisper is an open-source speech recognition model released by OpenAI in 2022. nunchi uses
`faster-whisper-large-v3` by default (`SPEACHES_MODEL` in `lib/server/env.ts:19`).

### Step 1: audio → spectrogram

Neural networks don't work well on raw samples. Whisper first converts the audio into a
**log-Mel spectrogram**, a picture of which frequencies are loud at each moment:

```
 frequency (Mel bins, low → high, spaced like human hearing)
   ▲
   │ ░░▒▒▓▓██▓▒░     ░▒▓██▓▒░        ← brighter = louder at that pitch
   │ ░▒▓██████▓▒░  ░▒▓█████▓▒░
   │ ▒▓████████▓▒░▒▓███████▓▒░
   └──────────────────────────────►  time (one column every 10 ms)
       "지  민   님 이 …"
```

Whisper always works on a **30-second window**. Shorter audio is padded with silence and
longer audio must be split. That's why nunchi splits clips by 25 seconds (chapter 03).
It also means **every clip costs a full 30-second pass** through the first half of the
model, however short the clip is (`docs/ENGINES-PLAN.md`, "Findings").

### Step 2: encoder → decoder (a Transformer)

Whisper is an **encoder–decoder Transformer**, the same family of architecture as
translation models and LLMs:

```
 spectrogram ──► ENCODER ──► "what sounds are in this audio" (a list of vectors)
                                     │
                                     ▼
 <|startoftranscript|> <|ko|> <|transcribe|> ──► DECODER ──► 지 → 민 → 님 → 이 → … → <|endoftext|>
                                                   ▲        (one token at a time, each new
                                                   └──────── token fed back as input)
```

The **decoder** writes the transcript one **token** (a word piece) at a time. Each new token
is chosen from probabilities, given the audio _and_ the tokens so far. This is the important
part: **the decoder is a language model**. It predicts likely text, not just sounds. That is
why Whisper is good at producing fluent sentences, and also why it sometimes produces fluent
sentences _that nobody said_ (Part 4).

### Step 3: special tokens control the task

The decoder starts from special tokens that tell it what to do:

- `<|startoftranscript|>`: begin.
- `<|ko|>`, `<|en|>`, …: the language. If it's not given, **the model predicts it**. That
  prediction is language detection.
- `<|transcribe|>` or `<|translate|>`: transcribe as-is, or translate to English. nunchi never
  uses Whisper's translate.
- `<|nospeech|>`: "there's no speech here". Its probability becomes `no_speech_prob`.
- `<|startofprev|>` + text: **previous text / prompt**, used as context (Part 3).

### Confidence numbers

For each segment of text, Whisper servers can report:

- **`avg_logprob`**: the average log-probability of the chosen tokens. Near 0 means
  confident; very negative (below -1.0) means guessing.
- **`no_speech_prob`**: how likely the model thinks it is that the audio contains no speech.

nunchi uses both to filter made-up text (Part 4).

### faster-whisper and Speaches

- **faster-whisper** is a re-implementation of Whisper on CTranslate2, an optimized inference
  engine. It's several times faster and uses less GPU memory, with the same model weights.
- **Speaches** is an open-source server that runs faster-whisper behind an
  **OpenAI-compatible** HTTP API. Because it speaks the same API as OpenAI's cloud service,
  nunchi's client works with Speaches, OpenAI, or any other compatible server unchanged.

---

## Part 2: The transcription API

### The request

`POST {baseUrl}/audio/transcriptions` as `multipart/form-data` (the format browsers use for
file uploads). See `speech.transcribe` in `lib/core/openai-compatible.ts:404`:

```ts
form.append('file', encodeWav(audio), 'clip.wav'); // the audio file
form.append('model', config.model); // e.g. Systran/faster-whisper-large-v3
if (opts.language) form.append('language', opts.language); // 'ko' / 'en'; omitted = auto-detect
if (opts.prompt) form.append('prompt', opts.prompt); // spelling hints (Part 3)
form.append('temperature', '0'); // most likely text, no randomness
form.append('response_format', 'verbose_json'); // include language + segment scores
```

Each parameter, and why:

- **`language`**: with the "한국어 → English" preset, nunchi sends `ko`. Forcing the language
  is more accurate and skips detection. In Auto mode it's omitted and Whisper detects it.
- **`temperature: 0`**: temperature controls randomness when choosing tokens. 0 means "always
  take the most likely token", which is what you want from a transcript: the same audio gives
  the same text.
- **`response_format: verbose_json`**: plain `json` returns only `text`. `verbose_json` adds
  the detected `language`, the `duration`, and `segments` with `no_speech_prob` and
  `avg_logprob`, which the filter needs. DECISIONS.md (Phase 0) notes that this is why
  Speaches was first called with plain `fetch` + `FormData` instead of the OpenAI SDK: to keep
  those fields without type casts.

### The response

```json
{
  "text": " 지민 님이 이번 릴리스 계획을 발표하겠습니다.",
  "language": "korean",
  "duration": 2.84,
  "segments": [{ "text": " 지민 님이 …", "no_speech_prob": 0.02, "avg_logprob": -0.21 }]
}
```

`parseTranscription` (`openai-compatible.ts:182`) converts it into the app's own
`TranscriptionResult` type (`lib/types.ts:72`):

- trims the text (Whisper adds a leading space),
- **normalizes the language**: some servers say `"ko"`, others `"korean"`.
  `normalizeWhisperLanguage` (`lib/languages.ts:17`) maps both to `ko`,
- converts seconds to milliseconds and snake_case to camelCase,
- treats **missing scores as confident speech** (`?? 0`). A server that doesn't report scores
  then never trips the no-speech filter (DECISIONS.md, Engines Phase 2).

**Why convert to our own type at all?** This is the **adapter** idea (chapter 12): outside
formats are translated once, at the edge, so the rest of the app only knows one clean shape.
If a different server returns slightly different JSON, only this function changes.

---

## Part 3: Helping Whisper with names: the prompt

Whisper has never heard "지민" spelled as your colleague spells it, or your product's name.
The **prompt** is text given to the decoder as "previous text" (the `<|startofprev|>` slot).
The model continues as if the prompt came right before this audio, so it tends to reuse its
spellings and style.

`buildWhisperPrompt` (`lib/pipeline/whisper-prompt.ts:9`) builds:

```
"지민, 넥스트릴리스, 김 팀장. …이번 분기 목표를 정리하면"
 └── glossary terms ──────┘  └── tail of the previous sentence ─┘
```

- **Glossary terms first**, de-duplicated, ending with a period.
- **Then the end of the previous sentence** (`previousSource` in `lib/pipeline/queue.ts:169`),
  for continuity: a sentence split by a pause often continues the last one.
- **Capped at 200 characters**, and the tail is only added if more than 20 characters of room
  remain. The comment explains why: _"long prompts make Whisper repeat itself"_. The decoder
  can latch onto the prompt and copy it into the output.

The server enforces the same 200-character limit (`transcribeFieldsSchema`,
`lib/api/contract.ts:27`).

---

## Part 4: When Whisper makes things up (hallucinations)

Whisper was trained largely on audio with subtitles from the internet, including lots of
YouTube-style video. When given **silence or noise**, its language-model decoder still wants
to output _something_, and it outputs what usually appeared at the end of those videos:

- "시청해주셔서 감사합니다" (Thank you for watching)
- "구독과 좋아요 부탁드립니다" (Please like and subscribe)
- "MBC 뉴스 이덕영입니다" (a news anchor sign-off)
- "Subtitles by the Amara.org community"

The VAD already avoids sending most silence, but noise, music and breathing still get
through. `hallucinationReason` (`lib/pipeline/hallucinations.ts:43`) runs four checks after
every transcription. The first match drops the line:

| Check       | Rule                                                                                                                       | Example                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `empty`     | nothing left after removing punctuation/spaces                                                                             | `"..."`                                |
| `filler`    | matches a known invented phrase (`KNOWN_FILLERS`, line 7), compared after lowercasing and stripping punctuation and spaces | `"시청해 주셔서 감사합니다!"`          |
| `no-speech` | **every** segment has `noSpeechProb > 0.6` **and** `avgLogprob < -1.0`                                                     | quiet hum transcribed as a random word |
| `repeat`    | the clip is under 2 s and identical to the previous line                                                                   | Whisper echoing the prompt on a cough  |

Notes on the design:

- `no-speech` requires **both** signals on **all** segments. Either signal alone is too noisy
  and would drop real speech. Missing a junk line is less harmful than losing a real one.
- The normalization (`normalize`, line 25) uses Unicode classes `\p{P}\p{S}` to strip
  punctuation and symbols in any script, Korean included.
- The list is meant to grow: _"Extend freely"_ (line 6).
- Dropped lines aren't deleted. They get `status: 'skipped'` and are hidden
  (`lib/pipeline/queue.ts:241`), so they still exist in the data if you need to debug.

---

## Part 5: When language detection goes wrong

On very short clips, "네." (yes) or "아, 그렇죠", Whisper's language detection is unreliable
and often answers Japanese or Chinese. In Auto mode that would produce a line in the wrong
script and pick the wrong translation direction.

`transcribeWithFallback` (`lib/core/transcribe.ts:28`):

```ts
let result = await speech.transcribe(audio, { language: forced, prompt, signal });
if (!forced && result.text !== '' && !isLang(result.language)) {
  // detected something other than ko/en → transcribe again, forced to Korean
  result = await speech.transcribe(audio, { language: FALLBACK_LANG, prompt, signal });
}
```

**Why Korean?** This is a tool for following _Korean_ meetings, so Korean is the most likely
language when detection fails (`PRIMARY_LANG` in `lib/pipeline/direction.ts:5`).

**Why on the server, inside one request?** DECISIONS.md (Phase 0): _"saving a client round
trip"_. The retry happens next to Speaches, not across the phone's network. Since the
engines refactor this function lives in `lib/core/`, so Custom endpoints in the browser run
the same logic (`lib/engines/endpoint.ts:124`).

This is also why the browser gives `/api/transcribe` **90 seconds** (`CALL_TIMEOUT_MS` in
`lib/engines/server.ts:95`): the server may call Speaches twice, at up to 30 seconds each.

---

## Part 6: The `/api/transcribe` route, line by line

`app/api/transcribe/route.ts:16`:

1. `checkAccess(request)`: the passcode, if the server has one (chapter 07).
2. `isConfigured('speaches')`: if this deployment has no Speaches URL, answer
   `503 not_configured`, so the UI can say "Speech not set up" instead of "error".
3. `readBodyLimited(request, MAX_BODY_BYTES)`: refuse more than 2 MB + 64 KB _before_ reading
   it all into memory.
4. Parse the multipart form and check there's an `audio` file.
5. Validate `language` and `prompt` with zod.
6. `decodeWav(...)`: reject anything that isn't 16 kHz mono 16-bit PCM (chapter 03).
7. `transcribeWithFallback(serverSpeech, samples, …)` with `request.signal`: if the browser
   cancels, the upstream call to Speaches is cancelled too.
8. Log one line with timings (`speachesMs`, `fallbackMs`, `audioMs`, `sizeKb`, `lang`) and
   return the JSON.
9. On error: a cancelled request is logged as `aborted` with status 499, and anything else
   goes through `errorResponse`, which turns it into a safe JSON error without leaking
   upstream details (chapter 07).

## Why not real-time streaming recognition?

Some speech recognizers stream: they take audio continuously and emit partial words as you
speak. Whisper is not one of them, since it needs a finished chunk. nunchi's design (VAD cuts
sentences, each sentence is transcribed whole) is the standard way to use Whisper live. It
has real advantages:

- It works with **any OpenAI-compatible server**: self-hosted Speaches, a laptop, the cloud.
- **Whole sentences translate better** than fragments.
- Requests are simple, independent HTTP calls that are easy to retry, queue and test.

The cost is latency: a line appears only after the speaker pauses (about 0.6 s) plus
processing time. (This comparison is explanation, not something written in the repo's docs.)

## Try it

1. Run `pnpm mock`, then send a transcription request by hand:

   ```bash
   curl -s http://localhost:8787/v1/audio/transcriptions \
     -F file=@tests/fixtures/speech-en.wav -F model=x -F language=en \
     -F response_format=verbose_json | jq
   ```

   This is exactly what Speaches receives. Now do the same through the app
   (`pnpm dev:mock` running):

   ```bash
   curl -s http://localhost:3000/api/transcribe -F audio=@tests/fixtures/speech-en.wav -F language=auto | jq
   ```

   Compare the two JSON shapes, and find where one becomes the other.

2. Send an MP3 or a 44.1 kHz WAV to `/api/transcribe` and read the `400` message. Find the line
   in `lib/audio/wav.ts` that produced it.
3. Read `tests/unit/hallucinations.test.ts`. Add a filler phrase you've seen Whisper produce
   and a test for it.
4. In `lib/pipeline/whisper-prompt.ts`, work out on paper what prompt is built for a
   glossary of 30 long names. Then check your answer against
   `tests/unit/whisper-prompt.test.ts`.
