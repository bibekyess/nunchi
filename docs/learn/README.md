# Learning nunchi: a guided tour of the code

This folder is a reading guide for people new to the codebase, written for someone who is
new to TypeScript and React. It explains **what** each part of the app does, **where** it
lives, and above all **why** it was built that way.

It sits next to two documents that already exist:

- [`../DECISIONS.md`](../DECISIONS.md): the build log, newest first. It records each decision
  when it was made, but it assumes you already know the code.
- [`../ENGINES-PLAN.md`](../ENGINES-PLAN.md): the plan for Server / Custom / On-device
  processing.

This guide is the "textbook" version: it explains things from the ground up and links into
both of those documents and into the source.

## How to read it

Read the chapters in order the first time. Each one builds on the one before.

| #   | Chapter                                                            | What you'll understand                                                             |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 00  | [Start here](00-start-here.md)                                     | Repo map, glossary, how to run things, how to read the rest                        |
| 01  | [The big picture](01-big-picture.md)                               | One sentence's journey from microphone to translated text                          |
| 02  | [TypeScript, React and Next.js primer](02-ts-react-next-primer.md) | Just enough of the language and frameworks to read this repo                       |
| 03  | [Audio capture and voice detection](03-audio-and-vad.md)           | Digital audio, the mic and tab capture, Silero VAD, WAV files                      |
| 04  | [How speech recognition works](04-speech-recognition.md)           | Whisper, the transcription API, prompts, filtering out made-up text                |
| 05  | [Translation and summaries with an LLM](05-translation-and-llm.md) | Chat completions, streaming (SSE), prompts, `<think>` stripping, chunked summaries |
| 06  | [The job queue](06-pipeline-queue.md)                              | Concurrency, ordering, retries, offline handling, cancellation                     |
| 07  | [The server side](07-server-layer.md)                              | API routes, env validation, passcode, size limits, logging, security headers       |
| 08  | [Engines: Server, Custom, On-device](08-engines.md)                | The plug-in architecture that lets each task run in a different place              |
| 09  | [State, sessions and storage](09-state-and-storage.md)             | Zustand stores, the session controller, IndexedDB, crash recovery                  |
| 10  | [The UI layer](10-ui.md)                                           | Pages, components, rendering performance, accessibility                            |
| 11  | [Testing and tooling](11-testing-and-tooling.md)                   | Unit / integration / e2e tests, mock servers, CI, Docker                           |
| 12  | [Design principles](12-design-principles.md)                       | The recurring ideas behind the whole codebase, collected in one place              |

Chapters 03–06 cover the speech pipeline, which is the core of the app, so they go into the
most depth.

## Conventions used in this guide

- `lib/pipeline/queue.ts:190` means file `lib/pipeline/queue.ts`, line 181. In VS Code you
  can Ctrl/Cmd-click it, or use "Go to File" (Ctrl/Cmd+P) and type `queue.ts:190`. Line
  numbers match the code as of October 2026 and may drift a little as the code changes.
- **Why** sections give the reasoning. When the reasoning comes from `DECISIONS.md` or a code
  comment, the guide says so. When it is an explanation of a common engineering practice
  (inferred from the code rather than written down), it says that too.
- Each chapter ends with **Try it** exercises. They are optional, but running and breaking
  things is the fastest way to learn.
