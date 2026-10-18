import { translateBodySchema } from '@/lib/api/contract';
import { startTranslation, type TranslationRun } from '@/lib/core/translate';
import { checkAccess } from '@/lib/server/auth';
import { isConfigured } from '@/lib/server/env';
import {
  errorResponse,
  notConfigured,
  parseJsonBody,
  streamText,
  toUpstreamError,
} from '@/lib/server/http';
import { serverChat } from '@/lib/server/llm';
import { withRequestLog } from '@/lib/server/log';

export const maxDuration = 60;

/**
 * Well above the largest valid body (a 2,000-character line, 5 context lines of up to 6,000
 * characters and a 200-term glossary), even as escaped UTF-8.
 */
const MAX_BODY_BYTES = 1024 * 1024;

export const POST = withRequestLog('translate', async (request, log) => {
  try {
    const denied = checkAccess(request);
    if (denied) return denied;
    if (!isConfigured('llm')) return notConfigured('llm');

    const { data: input, error } = await parseJsonBody(
      request,
      translateBodySchema,
      MAX_BODY_BYTES,
    );
    if (error) return error;
    const dir = `${input.sourceLang}->${input.targetLang}`;

    // Open the upstream stream before answering, so connection errors become a JSON error.
    let run: TranslationRun;
    try {
      run = await startTranslation(serverChat, input, request.signal);
    } catch (err) {
      // The client went away (stopped, navigated); nothing to send back.
      if (request.signal.aborted) {
        log.done('aborted', { dir });
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
      fields: ({ ttftMs }) => ({ openMs, ttftMs, dir }),
      okFields: (outChars) => ({
        outChars,
        retry: run.emptyRetry ? 'empty' : input.retry ? 'client' : undefined,
      }),
    });
  } catch (err) {
    log.done('error');
    return errorResponse(log, err);
  }
});
