# 09 — State, sessions and storage

This chapter covers where data lives while the app runs and how it survives a reload or a
crash:

| What                                                 | Where                    | File                                                                              |
| ---------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------- |
| the live session (lines, recorder state, banners)    | Zustand store, in memory | `lib/session/store.ts`                                                            |
| objects with a lifetime (mic, VAD, queue, wake lock) | `SessionController`      | `lib/session/controller.ts`                                                       |
| saved sessions and lines                             | IndexedDB (via Dexie)    | `lib/db/*`                                                                        |
| per-device preferences                               | localStorage             | `lib/browser/storage.ts`, `lib/display/store.ts`, `lib/settings/*`, `lib/audio/*` |

---

## Part 1: The session store

`useSessionStore` (`lib/session/store.ts:101`) holds everything the session page shows.

### Normalized shape: `ids` + `byId`

```ts
ids:  ['u1', 'u2', 'u3']                         // speech order
byId: { u1: {…utterance…}, u2: {…}, u3: {…} }    // lookup by id
```

Why not just an array of utterances? Because the translation of one line **changes many times
per second** while it streams:

- with an array, every change creates a new array, and every component reading the list would
  re-render,
- with `byId`, updating `u3` creates a new `byId` object and a new `u3`, but `ids` stays the
  **same array**. The list component (which selects `ids`) doesn't re-render. Only the one
  `UtteranceBlock` that selects `byId['u3']` does (`components/transcript/UtteranceBlock.tsx:84`).

This "normalized state" pattern is common in UI apps with many items that update
independently. The type comment says it too: _"Components select one utterance each by id"_
(line 17).

### All writes go through a few actions

`addUtterance`, `patchUtterance` and `appendTranslation` are the only ways lines change. The
comment (line 45) explains why: _"so it can later be persisted (Phase 3) and relayed to share
viewers (Phase 5)."_ That paid off: persistence was added later by **subscribing** to the store
(Part 3), without touching the queue.

### Derived values instead of duplicated ones

- **Listening time** is stored as `listenedMs` (finished stretches) plus `listeningSince` (when
  the current stretch began). `elapsedMs()` (line 84) adds them. The timer doesn't need to
  write to the store every second, and pauses are excluded naturally. `setRecorder` (line 202)
  does the bookkeeping on each state change and sets `endedAt` when recording stops.
- `setMicLevel` (line 217) ignores changes under 0.02, so the meter doesn't re-render for
  differences nobody can see.

### Two ways to access it

- From React: `useSessionStore(selector)`.
- From plain code (queue, controller, persistence): `sessionStore.getState()` and
  `sessionStore.subscribe(...)`. `sessionStore` is the same object, exported under a second name
  (line 231) to make "non-React access" obvious at the call site.

---

## Part 2: `SessionController`: things with a lifetime

React components appear and disappear, and in development they even mount twice. The
microphone, the VAD, the queue and the wake lock must be opened once and closed exactly once.
They live in a plain class, `SessionController` (`lib/session/controller.ts:25`):

> _"Owns everything with a lifetime outside React for one live session: the mic recorder, the
> job queue and the wake lock. State the UI needs goes into the session store."_

So there's a clean split:

- the **controller does things** (`start`, `pause`, `resume`, `stop`, `switchDevice`,
  `applyVadSettings`, `dispose`),
- the **store describes things** (`recorder: 'listening'`, `micLevel`, `interrupted`…),
- **components** read the store and call controller methods.

### Creating and destroying it

`SessionControllerProvider` (`components/session/controller-context.tsx:11`):

```ts
useEffect(() => {
  const cancelled = new AbortController();
  let c = null, stopPersisting = null;
  void openSession(sessionStore, sessionId, cancelled.signal).then((opened) => {
    if (!opened) return;                                   // user already left
    if (opened.persist) stopPersisting = persistSession(sessionStore);
    c = new SessionController();                           // created AFTER loading
    setController(c);
  });
  return () => {                                           // cleanup on leave / id change
    cancelled.abort(); c?.dispose(); …; void stopPersisting?.();
  };
}, [sessionId]);
```

- The controller is created **after** the saved session is loaded, so its queue continues
  numbering after the saved lines (comment, line 24).
- The page renders nothing until the controller exists (line 42), so child components can
  call `useController()` without null checks.
- The cleanup handles Strict Mode's double mount and fast navigation between sessions.

### The recorder state machine

```
          start()                    pause()
  idle ──────────► starting ──► listening ◄──────► paused
   ▲  ▲                │            │     resume()   │
   │  └── cancelled ───┘            │                │
   │       picker                   │ stop()         │ stop()
   │                                ▼                ▼
   └──────────────────────────────── idle ◄──────────┘
  error ◄── start failed (mic denied, VAD failed); start() again to retry
```

`startOrResume` (`controller-context.tsx:53`) is the one helper both mic buttons use, so the
big button in the empty state and the dock button behave the same.

---

## Part 3: Saving to IndexedDB

### Why IndexedDB, and why no server database?

DECISIONS.md (Phase 3): _"No database server: everything lives in the browser's IndexedDB."_
The goal is following a meeting, not archiving or sharing it. Keeping data on the device is
simpler (no accounts, no backups, no migrations on a server) and more private. localStorage
would be too small (about 5 MB) and synchronous. IndexedDB is a real database built into
browsers.

**Dexie** (`lib/db/dexie.ts`) wraps IndexedDB's awkward event-based API in Promises and adds
schema versions:

```ts
const stores = {
  sessions:   'id, createdAt',                     // primary key id, index on createdAt (for "recent")
  utterances: 'id, sessionId, [sessionId+seq]',    // compound index: one session's lines in order
};
this.version(1).stores(stores);
this.version(2).stores(stores).upgrade(…);        // fills in list stats for old sessions
```

The compound index `[sessionId+seq]` makes "all lines of session X in order" a single fast
range query (`bySeq`, line 77).

**Version 2** keeps a `preview` and `lineCount` on each session record, so the home page
doesn't read every line of every session. The `upgrade` function computes them once for
sessions saved before the change. These stats never reach the store: `withoutStats()` strips
them on load (line 84).

**Audio is never stored** (comment, line 29). Only text and metadata.

### `persistSession`: mirror the store into the database

`lib/db/persist.ts:39` subscribes to the store and writes what changed. The rules
(DECISIONS.md Phase 3, "Saving"):

| Change                                                          | When it's written                                       | Why                                               |
| --------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| a line becomes settled (`done` / `skipped` / `error`) or is new | at the end of the current tick (`setTimeout(flush, 0)`) | important and final, so don't lose it             |
| a translation streaming in                                      | batched, at most once per second                        | dozens of updates per second would be wasteful    |
| session fields (title, glossary, summary), recorder state       | at the end of the current tick                          | the saved duration stays correct after pause/stop |
| page is closing (`pagehide`)                                    | immediately                                             | last chance                                       |

More details worth noticing:

- **A session is first written with its first line** (line 61). Opening a session and leaving
  without speaking leaves nothing behind.
- **Writes are serialized** through a promise chain (`chain = chain.then(...)`, line 72), so an
  older snapshot can never land after a newer one.
- **Failed writes are retried** with doubling delays (2 s → 30 s max), and the affected lines
  are re-marked dirty (line 84). The comment explains the subtle bug this avoids: settled lines
  never change again, so if their only write failed they would never be saved otherwise. A
  banner says "Saving to this device is failing" meanwhile.
- **Dependency injection again**: `save` and `now` can be replaced in tests
  (`PersistOptions`, line 28).

### Opening a session and crash recovery

`openSession` (`lib/db/open-session.ts:13`):

1. Try to load the session. **If storage is blocked** (some private windows), the session
   still works, just unsaved (`persist: false`), and a banner says so. Importantly it does _not_
   then save a fresh empty session, because a saved copy might exist and would be overwritten
   (comment, line 10).
2. If the user navigated elsewhere while loading (`signal.aborted`), do nothing. A slow load
   must not replace the session now on screen.
3. Every loaded line passes through `recoverUtterance` (`persist.ts:18`). After a reload there
   is no audio in memory and no request running, so:
   - `transcribing` → error _"Interrupted before transcription"_ (can't retry: the audio is gone),
   - `translating` → error _"Interrupted while translating"_ (can retry from the saved text).

---

## Part 4: Per-device preferences in localStorage

Small settings that belong to the _device_, not the session: theme, display options, engine
choice, mic device, VAD settings, server access token (never the passcode itself), last
glossary.

`lib/browser/storage.ts` wraps every access in `try/catch`: _"Storage can be blocked (private
mode, disabled site data), so every access is guarded: reads fall back, writes are silently
dropped."_ A blocked localStorage then means "not remembered", never "app crashes".

`readJson(key, sanitize)` (line 27) **requires** a sanitize function that turns anything
(missing, old, corrupted, hand-edited) into a valid value. You can see it for VAD settings
(`normalizeVadSettings`), display (`sanitizeDisplay`), engines (`sanitizeEngineSettings`). The
type system makes it impossible to read stored JSON without validating it.

**Display preferences** (`lib/display/store.ts`) use Zustand's `persist` middleware with a
custom `merge` that runs `sanitizeDisplay`, so a language removed from the app can't break
the view filter. They're per device, separate from the session (DECISIONS.md Phase 2).

**The last glossary** pre-fills new sessions (`LAST_GLOSSARY_KEY`, `lib/session/store.ts:62`),
because the same team usually has the same names every week.

## Try it

1. In DevTools → Application → IndexedDB → `nunchi` → `utterances`, watch rows appear while you
   speak. Note that a streaming line's `translation` updates about once per second.
2. Start speaking, and while a line still shimmers, reload the page. Find the
   "Interrupted before transcription" line and match it to `recoverUtterance`.
3. Open a private window, start a session, and look for the storage banner. (In some browsers
   private mode still has IndexedDB; then nothing appears, which is fine.)
4. Edit `nunchi.vadSettings` in localStorage to `{"redemptionMs": 99999, "speechThreshold": "x"}`,
   reload, open Audio settings, and see what `normalizeVadSettings` turned it into.
