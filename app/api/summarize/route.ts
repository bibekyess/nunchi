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
import { withRequestLog } from '@/lib/server/log';

export const maxDuration = 300;

/** Room for `SUMMARY_MAX_CHARS` of Korean (3 bytes a character) plus JSON and the glossary. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export const POST = withRequestLog('summarize', async (request, log) => {
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
    let parts: number | undefined;
    let partsMs: number | undefined;
    try {
      run = await startSummary(serverChat, input, lines, {
        signal: request.signal,
        onPartsDone: (count, ms) => {
          parts = count;
          partsMs = ms;
        },
      });
    } catch (err) {
      if (request.signal.aborted) {
        log.done('aborted', { parts, partsMs, lines: lines.length });
        return new Response(null, { status: 499 });
      }
      throw toUpstreamError(err);
    }
    const openMs = log.elapsed();

    return streamText({
      log,
      text: run.text,
      abort: run.abort,
      signal: request.signal,
      fields: ({ ttftMs }) => ({ parts, partsMs, openMs, ttftMs, lines: lines.length }),
      okFields: (outChars) => ({ outChars }),
      // The merge prompt is long; its first piece may take the model's whole call timeout.
      firstMs: SUMMARY_TIMEOUT_MS + 30_000,
    });
  } catch (err) {
    log.done('error');
    return errorResponse(log, err);
  }
});
