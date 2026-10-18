import { summarizeBodySchema } from '@/lib/api/contract';
import {
  startSummary,
  SUMMARY_MAX_CHARS,
  SUMMARY_TIMEOUT_MS,
  SUMMARY_TOO_LONG_MESSAGE,
  summaryLines,
  transcriptChars,
  type SummaryRun,
} from '@/lib/core/summarize';
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

/** Room for `SUMMARY_MAX_CHARS` of Korean (3 bytes a character) plus JSON and the glossary. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
  const elapsed = startTimer();
  try {
    const denied = checkAccess(request);
    if (denied) return denied;
    if (!isConfigured('llm')) return notConfigured('llm');

    const { data, error } = await parseJsonBody(request, summarizeBodySchema, MAX_BODY_BYTES);
    if (error) return error;

    const { utterances, ...input } = data;
    if (transcriptChars(utterances) > SUMMARY_MAX_CHARS) {
      return jsonError('payload_too_large', SUMMARY_TOO_LONG_MESSAGE);
    }
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
      // The merge prompt is long; its first piece may take the model's whole call timeout.
      firstMs: SUMMARY_TIMEOUT_MS + 30_000,
    });
  } catch (err) {
    logTiming('summarize', 'error', { total: ms(elapsed()) });
    return errorResponse('summarize', err);
  }
}
