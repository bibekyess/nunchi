import { transcribeFieldsSchema } from '@/lib/api/contract';
import { decodeWav, WavError } from '@/lib/audio/wav';
import { transcribeWithFallback } from '@/lib/core/transcribe';
import { checkAccess } from '@/lib/server/auth';
import { isConfigured } from '@/lib/server/env';
import { errorResponse, jsonError, notConfigured, readBodyLimited } from '@/lib/server/http';
import { withRequestLog } from '@/lib/server/log';
import { serverSpeech } from '@/lib/server/speaches';

export const maxDuration = 60;

const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // ~65 s of 16 kHz 16-bit mono; clips are capped at 30 s
/** The clip plus the form's other fields and boundaries. */
const MAX_BODY_BYTES = MAX_AUDIO_BYTES + 64 * 1024;

export const POST = withRequestLog('transcribe', async (request, log) => {
  let audioBytes: number | undefined;
  try {
    const denied = checkAccess(request);
    if (denied) return denied;
    if (!isConfigured('speaches')) return notConfigured('speaches');

    const body = await readBodyLimited(request, MAX_BODY_BYTES);
    if (!body) return jsonError('payload_too_large', 'Audio clip is larger than 2 MB.');
    let form: FormData;
    try {
      const contentType = request.headers.get('content-type') ?? '';
      form = await new Response(body, { headers: { 'Content-Type': contentType } }).formData();
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

    const fields = transcribeFieldsSchema.safeParse({
      language: form.get('language') ?? undefined,
      prompt: form.get('prompt') || undefined,
    });
    if (!fields.success) {
      return jsonError('bad_request', fields.error.issues[0]?.message ?? 'Invalid fields.');
    }
    const { language, prompt } = fields.data;
    audioBytes = audio.size;

    // Only the clips the app records are accepted; Speaches gets them re-encoded unchanged.
    let samples: Float32Array;
    try {
      samples = decodeWav(await audio.arrayBuffer());
    } catch (err) {
      if (err instanceof WavError) return jsonError('bad_request', err.message);
      throw err;
    }

    const { result, firstMs, fallbackMs } = await transcribeWithFallback(serverSpeech, samples, {
      language,
      prompt,
      signal: request.signal,
    });

    log.done('ok', {
      speachesMs: firstMs,
      fallbackMs,
      audioMs: result.durationMs,
      sizeKb: Math.round(audio.size / 1024),
      lang: result.language ?? 'none',
      mode: language === 'auto' ? 'auto' : 'forced',
    });
    return Response.json(result);
  } catch (err) {
    const fields = {
      sizeKb: audioBytes === undefined ? undefined : Math.round(audioBytes / 1024),
    };
    // The client went away (stopped, navigated); the cut-off upstream call isn't an error.
    if (request.signal.aborted) {
      log.done('aborted', fields);
      return new Response(null, { status: 499 });
    }
    log.done('error', fields);
    return errorResponse(log, err);
  }
});
