import { z } from 'zod';
import { LANG_CODES } from '@/lib/languages';
import {
  buildMergeMessages,
  buildSummarizeMessages,
  chunkLines,
  formatLine,
  type SummarizePromptInput,
} from '@/lib/prompts/summarize';
import type { ChatMessage } from '@/lib/prompts/translate';
import { checkAccess } from '@/lib/server/auth';
import { getEnv } from '@/lib/server/env';
import { errorResponse, isTimeoutError, jsonError, UpstreamError } from '@/lib/server/http';
import { getLlm, VLLM_NO_THINKING } from '@/lib/server/llm';
import { logTiming, ms, startTimer } from '@/lib/server/timing';
import { ThinkStripper } from '@/lib/think-stripper';

export const maxDuration = 300;

const bodySchema = z.object({
  utterances: z
    .array(
      z.object({
        seq: z.number().int().nonnegative(),
        sourceText: z.string().max(2000),
        translation: z.string().max(4000).optional(),
      }),
    )
    .min(1)
    .max(5000),
  glossary: z
    .array(z.object({ term: z.string().max(100), translation: z.string().max(200).optional() }))
    .max(200)
    .default([]),
  meetingContext: z.string().max(1000).optional(),
  outputLang: z.enum(LANG_CODES),
});

const SUMMARY_TOKENS = 1500;
const PART_TOKENS = 800;
/** Summaries are long generations; the shared client's 60 s timeout is for translations. */
const TIMEOUT_MS = 180_000;
const PART_CONCURRENCY = 2;

function toUpstreamError(err: unknown): UpstreamError {
  if (err instanceof UpstreamError) return err;
  if (isTimeoutError(err)) return new UpstreamError('llm', 'upstream_timeout', undefined);
  const status = (err as { status?: number })?.status;
  return new UpstreamError('llm', 'upstream_error', status, String(err));
}

async function complete(messages: ChatMessage[], signal: AbortSignal): Promise<string> {
  const res = await getLlm().chat.completions.create(
    {
      model: getEnv().LLM_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: PART_TOKENS,
      ...VLLM_NO_THINKING,
    },
    { signal, timeout: TIMEOUT_MS },
  );
  const stripper = new ThinkStripper();
  return (stripper.push(res.choices[0]?.message?.content ?? '') + stripper.flush()).trim();
}

/** Summarizes each part, a few at a time, keeping their order. */
async function summarizeParts(
  input: SummarizePromptInput,
  chunks: string[][],
  signal: AbortSignal,
): Promise<string[]> {
  const out = new Array<string>(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      out[i] = await complete(
        buildSummarizeMessages(input, chunks[i], { index: i, total: chunks.length }),
        signal,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, chunks.length) }, worker));
  return out;
}

export async function POST(request: Request) {
  const elapsed = startTimer();
  try {
    const denied = checkAccess(request);
    if (denied) return denied;

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError('bad_request', 'Expected a JSON body.');
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return jsonError('bad_request', `${issue?.path.join('.') || 'body'}: ${issue?.message}`);
    }

    const { utterances, ...input } = parsed.data;
    const lines = [...utterances]
      .filter((u) => u.sourceText.trim())
      .sort((a, b) => a.seq - b.seq)
      .map(formatLine);
    if (lines.length === 0) return jsonError('bad_request', 'The transcript is empty.');

    const env = getEnv();
    const llm = getLlm();

    // Open the upstream stream before answering, so failures become a JSON error.
    let upstream;
    let parts: string | undefined;
    try {
      const chunks = chunkLines(lines);
      let messages: ChatMessage[];
      if (chunks.length === 1) {
        messages = buildSummarizeMessages(input, chunks[0]);
      } else {
        const partsTimer = startTimer();
        const partSummaries = await summarizeParts(input, chunks, request.signal);
        parts = `${chunks.length}/${partsTimer()}ms`;
        messages = buildMergeMessages(input, partSummaries);
      }
      upstream = await llm.chat.completions.create(
        {
          model: env.LLM_MODEL,
          messages,
          stream: true,
          temperature: 0.2,
          max_tokens: SUMMARY_TOKENS,
          ...VLLM_NO_THINKING,
        },
        { signal: request.signal, timeout: TIMEOUT_MS },
      );
    } catch (err) {
      if (request.signal.aborted) {
        logTiming('summarize', 'aborted', { parts, total: ms(elapsed()), lines: lines.length });
        return new Response(null, { status: 499 });
      }
      throw toUpstreamError(err);
    }
    const openMs = elapsed();

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const stripper = new ThinkStripper();
        let outChars = 0;
        let ttftMs: number | undefined;
        const timings = () => ({
          parts,
          open: ms(openMs),
          ttft: ms(ttftMs),
          total: ms(elapsed()),
          lines: lines.length,
        });
        const send = (text: string) => {
          if (!text) return;
          ttftMs ??= elapsed();
          outChars += text.length;
          controller.enqueue(encoder.encode(text));
        };
        try {
          for await (const chunk of upstream) {
            send(stripper.push(chunk.choices[0]?.delta?.content ?? ''));
          }
          send(stripper.flush());
          logTiming('summarize', 'ok', { ...timings(), out: `${outChars}ch` });
          controller.close();
        } catch (err) {
          if (request.signal.aborted) {
            logTiming('summarize', 'aborted', timings());
            controller.close();
            return;
          }
          const e = toUpstreamError(err);
          logTiming('summarize', 'error', timings());
          console.error(`[summarize] stream failed: ${e.message}`, e.detail?.slice(0, 500) ?? '');
          controller.error(e);
        }
      },
      cancel() {
        upstream.controller.abort();
      },
    });

    return new Response(body, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    logTiming('summarize', 'error', { total: ms(elapsed()) });
    return errorResponse('summarize', err);
  }
}
