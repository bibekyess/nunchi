import { z } from 'zod';
import { LANG_CODES } from '@/lib/languages';
import { startTranslation, type TranslationRun } from '@/lib/core/translate';
import { checkAccess } from '@/lib/server/auth';
import { errorResponse, isTimeoutError, jsonError, UpstreamError } from '@/lib/server/http';
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

    const dir = `${parsed.data.sourceLang}->${parsed.data.targetLang}`;

    // Open the upstream stream before answering, so connection errors become a JSON error.
    let run: TranslationRun;
    try {
      run = await startTranslation(serverChat, parsed.data, request.signal);
    } catch (err) {
      // The client went away (stopped, navigated); nothing to send back.
      if (request.signal.aborted) {
        logTiming('translate', 'aborted', { total: ms(elapsed()), dir });
        return new Response(null, { status: 499 });
      }
      throw toUpstreamError(err);
    }
    const openMs = elapsed();

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let emitted = '';
        let ttftMs: number | undefined;
        const timings = () => ({
          open: ms(openMs),
          ttft: ms(ttftMs),
          total: ms(elapsed()),
          dir,
        });
        const send = (text: string) => {
          if (!text) return;
          ttftMs ??= elapsed();
          emitted += text;
          controller.enqueue(encoder.encode(text));
        };

        try {
          for await (const text of run.text) send(text);
          logTiming('translate', 'ok', {
            ...timings(),
            out: `${emitted.length}ch`,
            retry: run.emptyRetry ? 'empty' : parsed.data.retry ? 'client' : undefined,
          });
          controller.close();
        } catch (err) {
          if (request.signal.aborted) {
            logTiming('translate', 'aborted', timings());
            controller.close();
            return;
          }
          const e = toUpstreamError(err);
          logTiming('translate', 'error', timings());
          console.error(`[translate] stream failed: ${e.message}`, e.detail?.slice(0, 500) ?? '');
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
    logTiming('translate', 'error', { total: ms(elapsed()) });
    return errorResponse('translate', err);
  }
}
