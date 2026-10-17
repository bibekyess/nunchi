import {
  buildMergeMessages,
  buildSummarizeMessages,
  chunkLines,
  formatLine,
  type SummarizePromptInput,
  type SummaryLine,
} from '@/lib/prompts/summarize';
import { ThinkStripper } from '@/lib/think-stripper';
import type { ChatMessage, ChatModel, ChatStream } from './models';

export const SUMMARY_TOKENS = 1500;
export const PART_TOKENS = 800;
/** Summaries are long generations; the default model timeout is meant for translations. */
export const SUMMARY_TIMEOUT_MS = 180_000;
const PART_CONCURRENCY = 2;

/** Formatted transcript lines in speech order, blank ones dropped. */
export function summaryLines(utterances: SummaryLine[]): string[] {
  return [...utterances]
    .filter((u) => u.sourceText.trim())
    .sort((a, b) => a.seq - b.seq)
    .map(formatLine);
}

export interface SummaryRun {
  /** Summary markdown as it arrives, reasoning removed. */
  text: AsyncIterable<string>;
  /** Stops the upstream request. */
  abort(): void;
}

export interface SummaryOptions {
  signal?: AbortSignal;
  /** Called after a long transcript's parts are summarized, before the merge starts. */
  onPartsDone?: (count: number, ms: number) => void;
}

function stripAll(text: string): string {
  const stripper = new ThinkStripper();
  return (stripper.push(text) + stripper.flush()).trim();
}

async function complete(chat: ChatModel, messages: ChatMessage[], signal?: AbortSignal) {
  const content = await chat.complete(messages, {
    temperature: 0.2,
    maxTokens: PART_TOKENS,
    signal,
    timeoutMs: SUMMARY_TIMEOUT_MS,
  });
  return stripAll(content);
}

/** Summarizes each part, a few at a time, keeping their order. */
async function summarizeParts(
  chat: ChatModel,
  input: SummarizePromptInput,
  chunks: string[][],
  signal?: AbortSignal,
): Promise<string[]> {
  const out = new Array<string>(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      out[i] = await complete(
        chat,
        buildSummarizeMessages(input, chunks[i], { index: i, total: chunks.length }),
        signal,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, chunks.length) }, worker));
  return out;
}

/**
 * Opens a streamed summary of formatted `lines` (see `summaryLines`). A transcript longer than
 * one chunk is summarized in parts first (not streamed), then the merge is streamed. Resolves
 * once the final stream is open.
 */
export async function startSummary(
  chat: ChatModel,
  input: SummarizePromptInput,
  lines: string[],
  { signal, onPartsDone }: SummaryOptions = {},
): Promise<SummaryRun> {
  const chunks = chunkLines(lines);
  let messages: ChatMessage[];
  if (chunks.length === 1) {
    messages = buildSummarizeMessages(input, chunks[0]);
  } else {
    const t0 = performance.now();
    const partSummaries = await summarizeParts(chat, input, chunks, signal);
    onPartsDone?.(chunks.length, Math.round(performance.now() - t0));
    messages = buildMergeMessages(input, partSummaries);
  }

  const upstream: ChatStream = await chat.stream(messages, {
    temperature: 0.2,
    maxTokens: SUMMARY_TOKENS,
    signal,
    timeoutMs: SUMMARY_TIMEOUT_MS,
  });

  async function* text() {
    const stripper = new ThinkStripper();
    for await (const delta of upstream) {
      const out = stripper.push(delta);
      if (out) yield out;
    }
    const tail = stripper.flush();
    if (tail) yield tail;
  }

  return { text: text(), abort: () => upstream.abort() };
}
