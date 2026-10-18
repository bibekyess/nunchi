import {
  buildMergeMessages,
  buildSummarizeMessages,
  chunkLines,
  formatLine,
  type SummarizePromptInput,
  type SummaryLine,
} from '@/lib/prompts/summarize';
import { ThinkStripper } from '@/lib/core/think-stripper';
import { mapLimit } from '@/lib/util/concurrency';
import type { ChatMessage, ChatModel, ChatStream } from './models';

export const SUMMARY_TOKENS = 1500;
export const PART_TOKENS = 800;
/** Summaries are long generations; the default model timeout is meant for translations. */
export const SUMMARY_TIMEOUT_MS = 180_000;
/**
 * Most transcript text (originals plus translations) the server summarizes in one request.
 * A two-hour meeting is about 1,500 lines and 180,000 characters; this allows about three
 * hours of dense talk, i.e. at most ~13 parts, instead of hundreds of LLM calls.
 */
export const SUMMARY_MAX_CHARS = 300_000;
export const SUMMARY_TOO_LONG_MESSAGE = `The transcript is too long to summarize (over ${SUMMARY_MAX_CHARS.toLocaleString('en')} characters).`;
const PART_CONCURRENCY = 2;

/** Formatted transcript lines in speech order, blank ones dropped. */
export function summaryLines(utterances: SummaryLine[]): string[] {
  return [...utterances]
    .filter((u) => u.sourceText.trim())
    .sort((a, b) => a.seq - b.seq)
    .map(formatLine);
}

/** Characters of transcript text (originals plus translations), checked against the cap. */
export function transcriptChars(utterances: SummaryLine[]): number {
  return utterances.reduce((n, u) => n + u.sourceText.length + (u.translation?.length ?? 0), 0);
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
    // A few parts at a time, keeping their order.
    const partSummaries = await mapLimit(chunks, PART_CONCURRENCY, (chunk, i) =>
      complete(
        chat,
        buildSummarizeMessages(input, chunk, { index: i, total: chunks.length }),
        signal,
      ),
    );
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
