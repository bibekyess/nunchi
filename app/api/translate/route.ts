import { z } from 'zod';
import { startTranslation, type TranslationRun } from '@/lib/core/translate';
import {
  glossarySchema,
  langSchema,
  meetingContextSchema,
  translationContextSchema,
} from '@/lib/schemas';
import { checkAccess } from '@/lib/server/auth';
import { errorResponse, parseJsonBody, streamText, toUpstreamError } from '@/lib/server/http';
import { serverChat } from '@/lib/server/llm';
import { logTiming, ms, startTimer } from '@/lib/server/timing';

export const maxDuration = 60;

const bodySchema = z.object({
  text: z.string().trim().min(1).max(2000),
  sourceLang: langSchema,
  targetLang: langSchema,
  context: translationContextSchema,
  glossary: glossarySchema,
  meetingContext: meetingContextSchema,
  /** Second attempt after an empty or untranslated result: answer deterministically. */
  retry: z.boolean().optional(),
});

export async function POST(request: Request) {
  const elapsed = startTimer();
  try {
    const denied = checkAccess(request);
    if (denied) return denied;

    const { data: input, error } = await parseJsonBody(request, bodySchema);
    if (error) return error;
    const dir = `${input.sourceLang}->${input.targetLang}`;

    // Open the upstream stream before answering, so connection errors become a JSON error.
    let run: TranslationRun;
    try {
      run = await startTranslation(serverChat, input, request.signal);
    } catch (err) {
      // The client went away (stopped, navigated); nothing to send back.
      if (request.signal.aborted) {
        logTiming('translate', 'aborted', { total: ms(elapsed()), dir });
        return new Response(null, { status: 499 });
      }
      throw toUpstreamError(err);
    }
    const openMs = elapsed();

    return streamText({
      route: 'translate',
      text: run.text,
      abort: run.abort,
      signal: request.signal,
      elapsed,
      fields: ({ ttft, total }) => ({ open: ms(openMs), ttft, total, dir }),
      okFields: (outChars) => ({
        out: `${outChars}ch`,
        retry: run.emptyRetry ? 'empty' : input.retry ? 'client' : undefined,
      }),
    });
  } catch (err) {
    logTiming('translate', 'error', { total: ms(elapsed()) });
    return errorResponse('translate', err);
  }
}
