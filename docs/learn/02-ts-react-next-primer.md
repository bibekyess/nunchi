# 02 — TypeScript, React and Next.js: just enough to read this repo

This is not a full tutorial. It covers the language features and framework ideas this
codebase uses most, each with a real example from the repo. If a later chapter uses
something unfamiliar, come back here.

---

## Part 1: TypeScript

TypeScript is JavaScript plus **types**. Types are checked when you run `pnpm typecheck` and
in your editor, and then erased: the browser runs plain JavaScript.

### Interfaces and type aliases: describing data

```ts
// lib/types.ts
export interface Utterance {
  id: string;
  seq: number;
  sourceText?: string; // `?` = optional: may be undefined
  status: UtteranceStatus;
}
```

`interface` and `type` both name a shape. Hover over any variable in VS Code to see its type.

### Union types: "one of these"

```ts
export type UtteranceStatus = 'transcribing' | 'translating' | 'done' | 'skipped' | 'error';
```

A value of this type can only be one of these five strings. Misspell one and the code won't
compile. The repo uses unions instead of enums everywhere.

**Discriminated unions** let different variants carry different data:

```ts
// lib/engines/types.ts:12
export type EngineStatus =
  | { state: 'ready' }
  | { state: 'unavailable'; reason: string }
  | { state: 'error'; reason: string; needsPasscode?: boolean };
```

After `if (status.state === 'error')`, TypeScript knows `status.reason` exists. This is
called **narrowing**.

### `as const` and deriving types from values

```ts
// lib/languages.ts:3
export const SUPPORTED_LANGS = {
  ko: { name: 'Korean', ... },
  en: { name: 'English', ... },
} as const;

export type Lang = keyof typeof SUPPORTED_LANGS;   // 'ko' | 'en'
```

The _type_ `Lang` is computed from the _value_ `SUPPORTED_LANGS`. Adding a third language to
the object automatically updates the type, the menus and the prompts. This "one source of
truth" trick appears often (also `lib/engines/ids.ts`).

### Type guards

```ts
// lib/languages.ts:12
export function isLang(value: unknown): value is Lang { ... }
```

`value is Lang` tells TypeScript: if this returns true, treat `value` as a `Lang`. `unknown`
means "could be anything; check before use". It's safer than `any`, which turns checking off.

### Generics: functions that work for many types

```ts
// lib/util/concurrency.ts:11
async run<T>(task: () => Promise<T>): Promise<T>
```

`T` is a placeholder: whatever type `task` returns, `run` returns the same.

### `satisfies`: check without changing the type

```ts
// lib/api/contract.ts:32
export const translateBodySchema = z.object({ ... }) satisfies z.ZodType<TranslateRequest>;
```

This says "make sure this schema produces exactly a `TranslateRequest`". If someone changes
one but not the other, the build fails. It keeps the browser and the server in agreement.

### Classes

```ts
export class PipelineQueue {
  private nextSeq = 0;                                   // private field
  constructor(private readonly deps: QueueDeps) { ... }  // shorthand: declares + assigns this.deps
  enqueue(clip: Clip): string { ... }
}
```

`private` fields can't be touched from outside, and `readonly` can't be reassigned. Classes
here hold things with a **lifetime**: a recorder, a queue, a wake lock.

### Optional chaining and nullish coalescing

```ts
this.vad?.start();             // call only if this.vad isn't null/undefined
const seq = clip?.seq ?? 0;    // use 0 if the left side is null/undefined
cached ??= parseEnv(...);      // assign only if cached is null/undefined
```

---

## Part 2: Asynchronous JavaScript (very important here)

Almost everything in this app waits for something: the mic, the network, a model. JavaScript
is single-threaded, and it handles waiting with **Promises**.

### Promises and async/await

```ts
const res = await fetch('/api/health'); // pause this function until the response arrives
const data = await res.json();
```

An `async` function always returns a Promise. `await` pauses _that function only_. The rest
of the app (UI, audio) keeps running. `try { await … } catch (err) { … }` catches failures.

`Promise.all([a, b])` waits for several things in parallel (`app/api/health/route.ts:18`
pings both upstreams at once).

### Fire and forget: `void promise`

```ts
void this.runTranscribe(id); // lib/pipeline/queue.ts:72
```

This starts the job without waiting for it. `void` tells the linter "yes, I meant not to
await this". The job reports its outcome through the store instead.

### Cancellation: AbortController and AbortSignal

To cancel async work, you create an `AbortController`, pass its `.signal` to the work, and
call `.abort()` later:

```ts
const controller = new AbortController();
fetch(url, { signal: controller.signal }); // fetch rejects with an AbortError on abort
controller.abort();
```

The repo passes signals **everywhere**: when you leave a session page, one `abort()` stops
every in-flight request. Two helpers you'll see:

- `AbortSignal.any([a, b])`: aborts when either aborts (`lib/pipeline/queue.ts:193`).
- `AbortSignal.timeout(ms)`: aborts after a delay.

Code often checks `if (signal.aborted) return;` after an `await`, because the world may have
changed while it waited (chapter 06).

### Async iterables and generators: consuming streams

A streamed translation is a sequence of text pieces that arrive over time. JavaScript models
this as an **async iterable**, consumed with `for await`:

```ts
for await (const piece of run.text) {
  // lib/core/translate.ts:85
  full += piece;
  onDelta(piece);
}
```

You _produce_ one with an **async generator** (`async function*`), using `yield` to hand out
each piece:

```ts
async function* text() {
  // lib/core/translate.ts:39
  for await (const delta of upstream) {
    const out = stripper.push(delta);
    if (out) yield out;
  }
}
```

Generators can be chained like pipes: SSE bytes → `parseSse` → JSON chunks → text deltas →
`<think>` removal → idle-timeout guard → the route's response. Each stage is a small
generator that does one job. This is the backbone of chapter 05.

---

## Part 3: React

React builds UIs from **components**: functions that take **props** and return JSX (HTML-like
syntax).

```tsx
function LevelMeter({ speaking }: { speaking: boolean }) {
  const level = useSessionStore((s) => s.micLevel);
  return <span className={speaking ? 'bg-danger' : 'bg-ink-faint'} />;
}
```

When the data a component reads changes, React calls the function again (**re-renders**) and
updates the page to match.

### Hooks used in this repo

| Hook                   | What it does                                                                   | Example                                                                           |
| ---------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `useState`             | A value that survives re-renders; setting it re-renders                        | `const [tab, setTab] = useState('transcript')`                                    |
| `useEffect`            | Run code after rendering, e.g. subscribe/start something, and return a cleanup | creating the `SessionController` (`components/session/controller-context.tsx:20`) |
| `useLayoutEffect`      | Like `useEffect` but before the browser paints (for measuring/scrolling)       | auto-scroll in `TranscriptList.tsx:51`                                            |
| `useRef`               | A mutable box that doesn't re-render when changed; also points at DOM elements | `const scroller = useRef<HTMLDivElement>(null)`                                   |
| `useCallback`          | Keeps the same function between renders                                        | `use-summary.ts:75`                                                               |
| `useSyncExternalStore` | Subscribe to data that lives outside React (browser APIs, module variables)    | online/offline in `Banners.tsx:87`                                                |
| `useContext`           | Read a value provided higher up the tree                                       | `useController()`                                                                 |
| `memo`                 | Skip re-rendering a component if its props didn't change                       | `UtteranceBlock.tsx:77`                                                           |

**Effect cleanup** matters a lot here. In development, React's Strict Mode mounts components
twice to catch missing cleanups, so anything an effect opens (mic, timers, listeners) must be
closed by the function it returns. See the comment in `controller-context.tsx:24`.

### Custom hooks

A function named `useSomething` that calls other hooks. They live next to their domain as
`use-*.ts` files (`lib/session/use-summary.ts`, `lib/engines/use-engine-status.ts`).

### State outside React: Zustand

Component state (`useState`) dies with the component. Data shared by many components, or
written by non-React code like the queue, lives in a **Zustand store**:

```ts
// lib/session/store.ts:101
export const useSessionStore = create<SessionState>()((set, get) => ({
  ids: [],
  byId: {},
  patchUtterance: (id, patch) =>
    set((s) => ({ byId: { ...s.byId, [id]: { ...s.byId[id], ...patch } } })),
}));
```

- In a component: `useSessionStore((s) => s.byId[id])`. The function is a **selector**, and
  the component re-renders only when _that value_ changes.
- Outside React: `sessionStore.getState().patchUtterance(...)` (that's how the queue writes).

Notice the `{ ...s.byId, [id]: … }`: state is never modified in place. A new object is
created, so "did it change?" is a cheap `===` check. That's **immutability**, and both React
and Zustand depend on it.

---

## Part 4: Next.js (App Router)

Next.js is a framework on top of React that adds routing, a server, and a build system. This
repo uses **Next.js 16** with the App Router. Note from `AGENTS.md`: this version differs from
older tutorials, so check `node_modules/next/dist/docs/` when in doubt.

### Files are routes

| File                             | URL                  | Kind                              |
| -------------------------------- | -------------------- | --------------------------------- |
| `app/page.tsx`                   | `/`                  | page                              |
| `app/session/[id]/page.tsx`      | `/session/abc-123`   | page; `[id]` is a dynamic segment |
| `app/api/translate/route.ts`     | `/api/translate`     | API endpoint (exports `POST`)     |
| `app/layout.tsx`                 | wraps every page     | layout                            |
| `app/error.tsx`, `not-found.tsx` | shown on crash / 404 | special pages                     |

### Route handlers (API endpoints)

```ts
// app/api/translate/route.ts
export const POST = withRequestLog('translate', async (request, log) => { ... return Response });
```

They take a standard `Request` and return a standard `Response`. These are the same Web APIs
that `fetch` uses, which is why a lot of code works on both sides.

### Server Components vs Client Components

By default, components in `app/` are **Server Components**: rendered on the server, sent as
HTML, no interactivity. A file that needs state, effects or browser APIs starts with
`'use client'`. In this app nearly all interactive UI is client-side (`components/**`
mostly start with `'use client'`), because the core of the app (mic, VAD, queue, IndexedDB)
can only run in the browser. `app/page.tsx` itself is a Server Component that places client
components inside it.

### Hydration

The server sends HTML first, then the browser "hydrates" it by attaching React. The browser's
first render must produce the **same HTML** as the server did. The server can't read
`localStorage`, so settings stored there are shown as defaults until hydration finishes, and
only then switch to the saved value. See `useHydrated()` in
`lib/settings/use-engine-settings.ts:30` and the theme script in `app/layout.tsx:39`, which
sets the theme before the first paint so the screen doesn't flash.

---

## Part 5: Styling with Tailwind

`className="flex items-center gap-2 rounded-full"` uses **Tailwind CSS**: small utility
classes instead of separate CSS files. Colors like `text-ink` and `bg-lavender` are the app's
own **design tokens**, defined in `app/globals.css`. `cx(...)` (`components/ui/classes.ts`)
joins class names and skips falsy ones: `cx('a', cond && 'b')`.

## Try it

1. Hover over `UtteranceStatus` in `lib/types.ts`, then try `status: 'finished'` somewhere and
   run `pnpm typecheck` to see the error.
2. Read `lib/core/translate.ts` top to bottom and find: an interface, an async generator, a
   `for await`, an AbortSignal and a getter (`get emptyRetry()`).
3. In `components/controls/RecordBar.tsx`, find why `MicLevelRing` and `LevelMeter` are
   separate components (read the comment on line 8). This is a performance trick from
   Part 3: only they re-render 30 times a second.
