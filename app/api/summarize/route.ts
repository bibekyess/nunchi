import { z } from 'zod';
import { startSummary, summaryLines, type SummaryRun } from '@/lib/core/summarize';
import { glossarySchema, langSchema, meetingContextSchema } from '@/lib/schemas';
import { checkAccess } from '@/lib/server/auth';
import { isConfigured } from '@/lib/server/env';
import {
  errorResponse,
  jsonError,
  notConfigured,
  parseJsonBody,
  streamText,
  toUpstreamError,
} from '@/lib/server/http';
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
  glossary: glossarySchema,
  meetingContext: meetingContextSchema,
  outputLang: langSchema,
});

export async function POST(request: Request) {
  const elapsed = startTimer();
  try {
    const denied = checkAccess(request);
    if (denied) return denied;
    if (!isConfigured('llm')) return notConfigured('llm');

    const { data, error } = await parseJsonBody(request, bodySchema);
    if (error) return error;

    const { utterances, ...input } = data;
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

    return streamText({
      route: 'summarize',
      text: run.text,
      abort: run.abort,
      signal: request.signal,
      elapsed,
      fields: ({ ttft, total }) => ({ parts, open: ms(openMs), ttft, total, lines: lines.length }),
      okFields: (outChars) => ({ out: `${outChars}ch` }),
    });
  } catch (err) {
    logTiming('summarize', 'error', { total: ms(elapsed()) });
    return errorResponse('summarize', err);
  }
}
