import { z } from 'zod';
import { startSummary, summaryLines, type SummaryRun } from '@/lib/core/summarize';
import { LANG_CODES } from '@/lib/languages';
import { checkAccess } from '@/lib/server/auth';
import { errorResponse, isTimeoutError, jsonError, UpstreamError } from '@/lib/server/http';
import { serverChat } from '@/lib/server/llm';
import { logTiming, ms, startTimer } from '@/lib/server/timing';

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

function toUpstreamError(err: unknown): UpstreamError {
  if (err instanceof UpstreamError) return err;
  if (isTimeoutError(err)) return new UpstreamError('llm', 'upstream_timeout', undefined);
  const status = (err as { status?: number })?.status;
  return new UpstreamError('llm', 'upstream_error', status, String(err));
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
    const lines = summaryLines(utterances);
    if (lines.length === 0) return jsonError('bad_request', 'The transcript is empty.');

    // Open the upstream stream before answering, so failures become a JSON error.
    let run: SummaryRun;
    let parts: string | undefined;
    try {
      run = await startSummary(serverChat, input, lines, {
        signal: request.signal,
        onPartsDone: (count, partsMs) => (parts = `${count}/${partsMs}ms`),
      });
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
          for await (const text of run.text) send(text);
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
        run.abort();
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
