import { z } from 'zod';
import { startTranslation, type TranslationRun } from '@/lib/core/translate';
import { LANG_CODES } from '@/lib/languages';
import { checkAccess } from '@/lib/server/auth';
import { errorResponse, parseJsonBody, streamText, toUpstreamError } from '@/lib/server/http';
import { serverChat } from '@/lib/server/llm';
import { logTiming, ms, startTimer } from '@/lib/server/timing';

export const maxDuration = 60;

const lang = z.enum(LANG_CODES);

const bodySchema = z.object({
  text: z.string().trim().min(1).max(2000),
  sourceLang: lang,
  targetLang: lang,
  context: z
    .array(z.object({ source: z.string().max(2000), translation: z.string().max(4000) }))
    .max(5)
    .default([]),
  glossary: z
    .array(z.object({ term: z.string().max(100), translation: z.string().max(200).optional() }))
    .max(200)
    .default([]),
  meetingContext: z.string().max(1000).optional(),
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
