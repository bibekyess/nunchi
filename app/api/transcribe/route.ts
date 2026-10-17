import { z } from 'zod';
import { transcribeWithFallback } from '@/lib/core/transcribe';
import { LANG_CODES } from '@/lib/languages';
import { checkAccess } from '@/lib/server/auth';
import { errorResponse, jsonError } from '@/lib/server/http';
import { serverSpeech } from '@/lib/server/speaches';
import { logTiming, ms, startTimer } from '@/lib/server/timing';

export const maxDuration = 60;

const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // ~65 s of 16 kHz 16-bit mono; clips are capped at 30 s

const fieldsSchema = z.object({
  language: z.enum([...LANG_CODES, 'auto']).default('auto'),
  prompt: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  const elapsed = startTimer();
  let audioBytes: number | undefined;
  try {
    const denied = checkAccess(request);
    if (denied) return denied;

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError('bad_request', 'Expected multipart/form-data.');
    }

    const audio = form.get('audio');
    if (!(audio instanceof Blob) || audio.size === 0) {
      return jsonError('bad_request', 'Missing "audio" file.');
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return jsonError('payload_too_large', 'Audio clip is larger than 2 MB.');
    }

    const fields = fieldsSchema.safeParse({
      language: form.get('language') ?? undefined,
      prompt: form.get('prompt') || undefined,
    });
    if (!fields.success) {
      return jsonError('bad_request', fields.error.issues[0]?.message ?? 'Invalid fields.');
    }
    const { language, prompt } = fields.data;
    audioBytes = audio.size;

    const { result, firstMs, fallbackMs } = await transcribeWithFallback(serverSpeech, audio, {
      language,
      prompt,
      signal: request.signal,
    });

    logTiming('transcribe', 'ok', {
      speaches: ms(firstMs),
      fallback: ms(fallbackMs),
      total: ms(elapsed()),
      audio: ms(result.durationMs),
      size: `${Math.round(audio.size / 1024)}KB`,
      lang: result.language ?? 'none',
      mode: language === 'auto' ? 'auto' : 'forced',
    });
    return Response.json(result);
  } catch (err) {
    logTiming('transcribe', request.signal.aborted ? 'aborted' : 'error', {
      total: ms(elapsed()),
      size: audioBytes === undefined ? undefined : `${Math.round(audioBytes / 1024)}KB`,
    });
    return errorResponse('transcribe', err);
  }
}
