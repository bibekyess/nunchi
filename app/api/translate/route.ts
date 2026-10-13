import { z } from 'zod';
import { LANG_CODES } from '@/lib/languages';
import { buildTranslateMessages } from '@/lib/prompts/translate';
import { checkAccess } from '@/lib/server/auth';
import { getEnv } from '@/lib/server/env';
import { errorResponse, isTimeoutError, jsonError, UpstreamError } from '@/lib/server/http';
import { getLlm, VLLM_NO_THINKING } from '@/lib/server/llm';
import { ThinkStripper } from '@/lib/think-stripper';

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

const MAX_TOKENS = 400;

function toUpstreamError(err: unknown): UpstreamError {
  if (err instanceof UpstreamError) return err;
  if (isTimeoutError(err)) return new UpstreamError('llm', 'upstream_timeout', undefined);
  const status = (err as { status?: number })?.status;
  return new UpstreamError('llm', 'upstream_error', status, String(err));
}

export async function POST(request: Request) {
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

    const env = getEnv();
    const llm = getLlm();
    const messages = buildTranslateMessages(parsed.data);

    // Open the upstream stream before answering, so connection errors become a JSON error.
    let upstream;
    try {
      upstream = await llm.chat.completions.create(
        {
          model: env.LLM_MODEL,
          messages,
          stream: true,
          temperature: parsed.data.retry ? 0 : 0.2,
          max_tokens: MAX_TOKENS,
          ...VLLM_NO_THINKING,
        },
        { signal: request.signal },
      );
    } catch (err) {
      // The client went away (stopped, navigated); nothing to report.
      if (request.signal.aborted) return new Response(null, { status: 499 });
      throw toUpstreamError(err);
    }

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const stripper = new ThinkStripper();
        let emitted = '';
        const send = (text: string) => {
          if (!text) return;
          emitted += text;
          controller.enqueue(encoder.encode(text));
        };

        try {
          for await (const chunk of upstream) {
            send(stripper.push(chunk.choices[0]?.delta?.content ?? ''));
          }
          send(stripper.flush());

          // Empty output: retry once, deterministically, without streaming.
          if (emitted.trim() === '' && !request.signal.aborted) {
            const retry = await llm.chat.completions.create(
              {
                model: env.LLM_MODEL,
                messages,
                temperature: 0,
                max_tokens: MAX_TOKENS,
                ...VLLM_NO_THINKING,
              },
              { signal: request.signal },
            );
            const again = new ThinkStripper();
            send(again.push(retry.choices[0]?.message?.content ?? '') + again.flush());
          }
          controller.close();
        } catch (err) {
          if (request.signal.aborted) {
            controller.close();
            return;
          }
          const e = toUpstreamError(err);
          console.error(`[translate] stream failed: ${e.message}`, e.detail?.slice(0, 500) ?? '');
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
    return errorResponse('translate', err);
  }
}
