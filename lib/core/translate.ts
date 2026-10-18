import { buildTranslateMessages, type TranslatePromptInput } from '@/lib/prompts/translate';
import { ThinkStripper } from '@/lib/core/think-stripper';
import type { ChatModel } from './models';

export const TRANSLATE_MAX_TOKENS = 400;

export interface TranslateInput extends TranslatePromptInput {
  /** Second attempt after an empty or untranslated result: answer deterministically. */
  retry?: boolean;
}

export interface TranslationRun {
  /** Translation text as it arrives, reasoning removed. */
  text: AsyncIterable<string>;
  /** True once the stream came back empty and the non-streamed retry ran. */
  readonly emptyRetry: boolean;
  /** Stops the upstream request. */
  abort(): void;
}

/**
 * Opens a streamed translation. Resolves once the upstream stream is open, so connection
 * errors reject here rather than mid-stream. If the stream yields nothing, it retries once,
 * deterministically and without streaming.
 */
export async function startTranslation(
  chat: ChatModel,
  input: TranslateInput,
  signal?: AbortSignal,
): Promise<TranslationRun> {
  const messages = buildTranslateMessages(input);
  const upstream = await chat.stream(messages, {
    temperature: input.retry ? 0 : 0.2,
    maxTokens: TRANSLATE_MAX_TOKENS,
    signal,
  });

  let emptyRetry = false;
  async function* text() {
    const stripper = new ThinkStripper();
    let emitted = '';
    for await (const delta of upstream) {
      const out = stripper.push(delta);
      if (out) {
        emitted += out;
        yield out;
      }
    }
    const tail = stripper.flush();
    if (tail) {
      emitted += tail;
      yield tail;
    }

    if (emitted.trim() === '' && !signal?.aborted) {
      emptyRetry = true;
      const content = await chat.complete(messages, {
        temperature: 0,
        maxTokens: TRANSLATE_MAX_TOKENS,
        signal,
      });
      const again = new ThinkStripper();
      const out = again.push(content) + again.flush();
      if (out) yield out;
    }
  }

  return {
    text: text(),
    get emptyRetry() {
      return emptyRetry;
    },
    abort: () => upstream.abort(),
  };
}

/** Translates one line, calling `onDelta` for each piece. Resolves with the full text. */
export async function runTranslation(
  chat: ChatModel,
  input: TranslateInput,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const run = await startTranslation(chat, input, signal);
  let full = '';
  for await (const piece of run.text) {
    full += piece;
    onDelta(piece);
  }
  return full;
}
