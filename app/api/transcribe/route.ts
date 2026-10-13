import { z } from 'zod';
import { LANG_CODES, isLang } from '@/lib/languages';
import { checkAccess } from '@/lib/server/auth';
import { errorResponse, jsonError } from '@/lib/server/http';
import { transcribe } from '@/lib/server/speaches';

export const maxDuration = 60;

const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // ~65 s of 16 kHz 16-bit mono; clips are capped at 30 s
const FALLBACK_LANG = 'ko' as const;

const fieldsSchema = z.object({
  language: z.enum([...LANG_CODES, 'auto']).default('auto'),
  prompt: z.string().max(200).optional(),
});

export async function POST(request: Request) {
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

    const forced = language === 'auto' ? undefined : language;
    let result = await transcribe(audio, { language: forced, prompt, signal: request.signal });

    // Whisper often mislabels short clips (e.g. "네.") as Japanese or similar.
    // When auto-detect lands outside the supported set, retry once with the main language.
    if (!forced && result.text !== '' && !isLang(result.language)) {
      result = await transcribe(audio, { language: FALLBACK_LANG, prompt, signal: request.signal });
      result.language ??= FALLBACK_LANG;
    }

    return Response.json(result);
  } catch (err) {
    return errorResponse('transcribe', err);
  }
}
