# 03 — Audio capture and voice activity detection

This chapter covers everything between "sound in the room" and "a clip of one sentence,
ready to transcribe". The files are all in `lib/audio/`:

| File              | Job                                                                    |
| ----------------- | ---------------------------------------------------------------------- |
| `devices.ts`      | open the microphone, list mics, turn browser errors into friendly ones |
| `sources.ts`      | choose mic / tab audio / both mixed                                    |
| `vad.ts`          | `SpeechRecorder`: runs the Silero VAD on the stream and emits clips    |
| `vad-settings.ts` | the user-tunable detection settings and their limits                   |
| `wav.ts`          | convert samples ⇄ WAV file bytes, and compute the level meter          |

---

## Part 1: Digital audio in five minutes

Sound is air pressure going up and down. A microphone turns it into a voltage, and the
computer measures that voltage many times per second. Each measurement is a **sample**.

- **Sample rate** = samples per second. Phone and laptop mics usually run at 44,100 or
  48,000 Hz. Speech recognition models are trained on **16,000 Hz** (16 kHz) audio. That is
  enough for the human voice (it captures frequencies up to 8 kHz, which covers speech) and
  is 3× less data than 48 kHz.
- **Channels**: mono (1) or stereo (2). Speech recognition wants mono.
- **Sample format**: in the browser, samples are 32-bit floats between **-1.0 and +1.0**,
  stored in a `Float32Array`. On disk (in a WAV file), they're usually 16-bit integers
  between -32,768 and +32,767.

So **one second of speech in this app = 16,000 floats**. Saved as 16-bit WAV that's 32,000
bytes, so 10 seconds ≈ 320 KB (the comment at `lib/audio/wav.ts:3`).

```
 amplitude
  +1 ┤      ╭╮        ╭─╮
     │  ╭╮ ╭╯╰╮  ╭╮  ╭╯ ╰╮      ← each dot of this curve is one sample;
   0 ┼──╯╰─╯  ╰──╯╰──╯   ╰──     16,000 of them per second
  -1 ┤
```

**Loudness** is measured from the samples' size. The level meter computes the
root-mean-square (RMS) of a frame, converts it to decibels, and maps -60 dB…0 dB to 0…1
(`frameLevel`, `lib/audio/wav.ts:94`).

---

## Part 2: Getting audio from the browser

### The microphone: `getUserMedia`

`openMicrophone()` (`lib/audio/devices.ts:44`):

```ts
navigator.mediaDevices.getUserMedia({
  audio: { channelCount: 1, echoCancellation: true, noiseSuppression: <setting>, autoGainControl: true },
});
```

The browser shows the permission prompt and returns a **`MediaStream`**: a live object, not a
file. Audio keeps flowing through it until you stop its **tracks**.

The constraints ask the browser's built-in audio processing for help:

- **echoCancellation**: removes the device's own speaker output from the mic signal.
- **noiseSuppression**: filters steady background noise. It's a user toggle, because it can
  also damage quiet voices.
- **autoGainControl**: evens out loud and quiet speakers, which helps a phone lying on a
  table in a meeting room.

Error handling turns raw browser exceptions into a few kinds the UI can explain
(`MicErrorKind`, `lib/audio/devices.ts:25`):

| Browser error                              | Becomes                    | Why it happens                                                         |
| ------------------------------------------ | -------------------------- | ---------------------------------------------------------------------- |
| page not on HTTPS                          | `insecure`                 | browsers only allow the mic in a "secure context" (HTTPS or localhost) |
| `NotAllowedError`                          | `denied`                   | the user (or a policy) blocked the mic                                 |
| `NotFoundError` / `NotReadableError`       | `no-device`                | no mic, or another app holds it                                        |
| `OverconstrainedError` with a saved device | retry with the default mic | the remembered mic was unplugged                                       |

`components/session/MicErrorScreen.tsx` then shows instructions specific to each kind.

### Tab audio: `getDisplayMedia`

For online meetings (Zoom in a browser tab, a YouTube video), the app can capture a **tab's
audio** instead of the room (`openTabAudio`, `lib/audio/sources.ts:57`). Things worth
knowing, all recorded in DECISIONS.md (Phase 2):

- Chrome only offers audio together with video, so the code asks for `video: true` and
  **stops the video track immediately**.
- Tab audio is captured with echo cancellation, noise suppression and gain control **off**.
  Those filters are tuned for a voice in a room, and a tab's audio is already a clean
  digital signal (this reason is inferred, not written down).
- It works only in **desktop Chromium**. Safari and Firefox implement `getDisplayMedia`
  without audio, and mobile browsers can't capture the screen at all.
  `canCaptureTabAudio()` (`sources.ts:28`) checks for `navigator.userAgentData`, which exists
  only in Chromium. That's a feature check, not user-agent sniffing.
- When the user clicks Chrome's "Stop sharing", the app **pauses** rather than restarting.
  Re-sharing needs a new picker _and_ a user tap (browsers require a "user gesture" for
  screen sharing), so a banner offers "Share again" (`lib/session/controller.ts:199`).

### Mixing both: the Web Audio API

"Tab + microphone" mode merges two streams into one with an `AudioContext`
(`mixStreams`, `sources.ts:88`):

```
mic stream ──► MediaStreamSource ─┐
                                  ├─► MediaStreamDestination ──► one mixed stream → VAD
tab stream ──► MediaStreamSource ─┘
```

Note the order in `openAudioInput` (`sources.ts:111`): the tab picker opens **first**, because
the browser only allows it while the tap still counts as a user gesture. Awaiting the mic
first could use that up.

### `AudioInput`: one shape for all three sources

Whatever the source, `openAudioInput` returns the same object (`sources.ts:36`): the stream
to listen to, the mic tracks and tab tracks (watched separately, because they end for
different reasons), and a `dispose()` that stops everything. The controller doesn't need to
know which source it got.

---

## Part 3: Voice Activity Detection (VAD)

### The problem

The mic produces audio forever. Whisper needs **finished chunks**, ideally one sentence each.
Something has to decide where speech starts and stops.

- **Fixed chunks** (every 5 s, say) cut words in half and send silence to the server.
- **Volume threshold** ("loud = speech") fails with background noise, music or a door slam.
- **A small neural network that recognizes human speech**. This is what nunchi uses:
  **Silero VAD v5**.

### How Silero VAD works

Silero is a tiny neural network (about 2 MB) that looks at **512 samples at a time (32 ms at
16 kHz)** and outputs the probability that the frame contains speech, from 0.0 to 1.0. It
keeps internal state between frames, so it uses context rather than judging each frame
alone.

It runs **in the browser**:

- The model is an `.onnx` file executed by **ONNX Runtime Web**, compiled to
  **WebAssembly** (WASM), which is fast, near-native code in the browser.
- Audio is processed in an **AudioWorklet**, a separate audio thread, so it doesn't freeze
  the UI.
- The library `@ricky0123/vad-web` wraps all this as `MicVAD`.

### From probabilities to clips: the state machine

The rules that turn per-frame probabilities into "speech started" and "speech ended" use the
settings from `lib/audio/vad-settings.ts`:

```
probability
 1.0 ┤        ██ ████ ██████                ████
     │      ███████████████████           ███████
 0.5 ┤─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  positive threshold (start)
 0.35┤· · · · · · · · · · · · · · · · · · · · · · ·  negative threshold (end)
 0.0 ┼──────────────────────────╨───────────────────────►  time
          ▲ speech start         │◄── 600 ms ──►▲ speech end → clip
     ◄300ms►                     quiet frames    (redemption)
     pre-speech pad
```

| Setting                      | Default          | Meaning                                                           |
| ---------------------------- | ---------------- | ----------------------------------------------------------------- |
| `speechThreshold` (positive) | 0.5              | probability needed to **start** a line                            |
| negative threshold           | threshold − 0.15 | probability below which frames count as **silence**               |
| `redemptionMs`               | 600 ms           | how long silence must last before the line **ends**               |
| `minSpeechMs`                | 400 ms           | shorter "speech" is a **misfire** (cough, click) and is discarded |
| `PRE_SPEECH_PAD_MS`          | 300 ms           | audio from _before_ the start is included                         |

**Why two thresholds?** This is called **hysteresis**. With a single threshold, a probability
hovering around 0.5 would flip between speech and silence on every frame. A lower "end"
threshold means speech must clearly drop off before it counts as silence. The 0.15 gap
follows Silero's authors' convention (`vad-settings.ts:31`).

**Why 600 ms of redemption?** The comment at `vad-settings.ts:17` says it: Korean speakers
pause mid-sentence. Shorter waits split sentences in half and hurt translation, while longer
waits add lag to every line. The user can tune it from 300 to 1200 ms.

**Why a 300 ms pre-speech pad?** The model needs a few frames to become confident, so by the
time it says "speech started" the first syllable has already passed. Keeping the previous
300 ms saves it (`vad-settings.ts:28`).

**Why `minSpeechMs` = 400?** It filters coughs and clicks, while the comment notes that
"네." (yes) still passes.

### `SpeechRecorder`: nunchi's wrapper

`lib/audio/vad.ts` wraps `MicVAD`. Each choice below is deliberate.

**1. We own the stream, not MicVAD** (DECISIONS.md Phase 1). Look at `vad.ts:55-57`:

```ts
getStream: async () => stream,
pauseStream: async () => {},       // pausing does NOT stop the mic tracks
resumeStream: async () => stream,
```

If MicVAD stopped the tracks on pause, resuming would open the mic again, and some browsers
ask for permission again. Keeping the stream open makes pause and resume instant and silent.

**2. It loads lazily.** `await import('@ricky0123/vad-web')` (`vad.ts:43`) downloads the model
and WASM (~16 MB) only when you first tap the mic, not when the home page loads.
`scripts/copy-vad-assets.mjs` copies those files into `public/vad/` at install time, so
they're served from this app's own origin. That matters for the Content Security Policy
(chapter 07), which also had to allow `'wasm-unsafe-eval'` and `blob:` workers.

**3. One WASM thread.** `ort.env.wasm.numThreads = 1` (`vad.ts:50`). Multi-threaded WASM needs
special cross-origin isolation headers, and one thread is plenty for a 2 MB model
(DECISIONS.md Phase 1).

**4. Force-split long monologues.** Whisper processes audio in **30-second windows** (chapter
04), so a 40-second clip would lose text. When speech starts, a 25-second timer starts too
(`MAX_UTTERANCE_MS`, `vad.ts:7`). If it fires, `forceSplit()` (`vad.ts:121`) pauses the VAD,
which with `submitUserSpeechOnPause: true` emits the audio so far as a clip, then starts it
again. Note the guard on line 127: if the user pressed Stop or left the page during that
`await`, don't restart. That was a real bug, fixed in the hardening pass (DECISIONS.md
2026-10-17).

**5. Live tuning.** `updateSettings()` (`vad.ts:67`) calls `MicVAD.setOptions(...)`, so moving
a slider in Audio settings applies immediately without reopening the mic.

**6. Callbacks, not coupling.** The recorder knows nothing about queues or stores. It takes
three callbacks (`onClip`, `onLevel`, `onSpeaking`) and the controller connects them
(`lib/session/controller.ts:69`). That keeps the recorder testable on its own
(`tests/unit/vad-recorder.test.ts`).

### Settings that can't break the app

`normalizeVadSettings` (`vad-settings.ts:45`) runs on everything read from localStorage. It
clamps each value to its range and snaps it to its step. Note the `toFixed(4)` that removes
float noise like `0.35000000000000003`. Old, corrupted or hand-edited storage can never
produce an invalid setting. The whole repo follows this pattern: **sanitize anything you read
from storage** (chapter 12).

---

## Part 4: WAV encoding

To send audio over HTTP it must become a file. WAV is the simplest audio format: a 44-byte
header followed by raw samples.

`encodeWav` (`lib/audio/wav.ts:4`) writes the header by hand with a `DataView`:

```
offset  bytes  content
0       4      "RIFF"
4       4      file size − 8
8       4      "WAVE"
12      4      "fmt "            ← format chunk
20      2      1 = PCM (uncompressed)
22      2      1 = mono
24      4      16000 = sample rate
34      2      16 = bits per sample
36      4      "data"
40      4      number of data bytes
44      …      the samples, 2 bytes each, little-endian
```

Then each float is converted to a 16-bit integer: `s < 0 ? s * 0x8000 : s * 0x7fff`. The
range is asymmetric (-32,768 … +32,767), hence two multipliers.

### Why does the server _decode_ the WAV again?

`/api/transcribe` doesn't pass the upload straight to Speaches. It decodes it with
`decodeWav` (`wav.ts:55`) and re-encodes it. Two reasons (DECISIONS.md 2026-10-17,
"The speech model takes samples"):

1. **Validation.** Only the exact format the app records is accepted (16 kHz, mono, 16-bit
   PCM). Anything else is a clear `400`, instead of an odd error from Speaches.
2. **One interface for every engine.** `SpeechModel.transcribe(audio: Float32Array)` takes
   samples, not files. On-device engines (planned) will take the samples directly, while HTTP
   engines encode a WAV internally. So the server also works with samples.

Re-encoding must give back **exactly the same bytes**, or audio quality would drift. A naive
decode `v / 32767` doesn't survive being stored as a 32-bit float: about half the values
come back one step lower. `fromInt16` (`wav.ts:45`) returns the _middle_ of the range that
`encodeWav` truncates to, which makes the round trip exact. `tests/unit/wav.test.ts` proves
it.

---

## Part 5: Keeping the recording alive

Phones are hostile to long-running audio. The controller watches for three problems
(`lib/session/controller.ts`):

| Problem                                                           | Detection                                                                                                       | Response                                                                                                                                                             |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The OS takes the mic (incoming call, lock screen)                 | the mic track fires `ended` (`onMicEnded`, line 210)                                                            | restart the recorder and show an "interrupted" banner                                                                                                                |
| The browser silently stops sending audio while the tab was hidden | when the page becomes visible, if no frame arrives within 1.5 s (`STALL_MS`, line 19; `onVisibility`, line 219) | same restart                                                                                                                                                         |
| The screen turns off                                              | —                                                                                                               | `ScreenWakeLock` keeps it on while listening, and re-acquires it when the page is visible again, because browsers drop the lock on hide (`lib/browser/wake-lock.ts`) |

## Try it

1. Open **Audio settings** (session ⋯ menu) and set "pause before a line ends" to 0.3 s,
   then to 1.2 s. Speak naturally with short pauses and compare how lines get split.
2. In `lib/audio/vad.ts`, temporarily change `MAX_UTTERANCE_MS` to `5_000`, talk for 15
   seconds, and watch three clips appear. Put it back afterwards.
3. Read `tests/unit/wav.test.ts` and find the test that proves the encode → decode → encode
   round trip is byte-identical.
4. Compute it: how many bytes is a 25-second clip as WAV? (25 × 16,000 × 2 + 44 = 800,044
   bytes ≈ 0.8 MB.) Now look at `MAX_AUDIO_BYTES` in `app/api/transcribe/route.ts:12` and
   explain the comment next to it.
