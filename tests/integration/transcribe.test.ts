import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/transcribe/route';
import { resetEnvCache } from '@/lib/server/env';
import { SPEACHES, TEST_ENV, wavBlob } from './helpers';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  resetEnvCache();
});

function request(fields: Record<string, string | Blob>, headers: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Request('http://app.test/api/transcribe', { method: 'POST', body: form, headers });
}

const verbose = (text: string, language: string) => ({
  text: ` ${text} `,
  language,
  duration: 1.25,
  segments: [{ text: ` ${text}`, no_speech_prob: 0.05, avg_logprob: -0.3 }],
});

describe('POST /api/transcribe', () => {
  it('forwards the clip to Speaches and normalizes the response', async () => {
    let sent: FormData | undefined;
    server.use(
      http.post(`${SPEACHES}/audio/transcriptions`, async ({ request }) => {
        sent = await request.formData();
        return HttpResponse.json(verbose('번역 잘 되고 있나요?', 'korean'));
      }),
    );

    const res = await POST(request({ audio: wavBlob(), language: 'auto', prompt: '키로' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      text: '번역 잘 되고 있나요?',
      language: 'ko',
      durationMs: 1250,
      segments: [{ text: '번역 잘 되고 있나요?', noSpeechProb: 0.05, avgLogprob: -0.3 }],
    });
    expect(sent?.get('model')).toBe('whisper-test');
    expect(sent?.get('language')).toBeNull(); // auto = let Whisper detect
    expect(sent?.get('prompt')).toBe('키로');
    expect(sent?.get('temperature')).toBe('0');
    expect(sent?.get('response_format')).toBe('verbose_json');
    expect(sent?.get('file')).toBeInstanceOf(Blob);
  });

  it('passes a forced language through', async () => {
    let language: FormDataEntryValue | null = null;
    server.use(
      http.post(`${SPEACHES}/audio/transcriptions`, async ({ request }) => {
        language = (await request.formData()).get('language');
        return HttpResponse.json(verbose('Yes.', 'en'));
      }),
    );
    const res = await POST(request({ audio: wavBlob(), language: 'en' }));
    expect(res.status).toBe(200);
    expect(language).toBe('en');
  });

  it('re-transcribes as Korean when auto-detect lands on an unsupported language', async () => {
    const languages: (FormDataEntryValue | null)[] = [];
    server.use(
      http.post(`${SPEACHES}/audio/transcriptions`, async ({ request }) => {
        const lang = (await request.formData()).get('language');
        languages.push(lang);
        return HttpResponse.json(lang ? verbose('네.', 'ko') : verbose('ね。', 'japanese'));
      }),
    );
    const res = await POST(request({ audio: wavBlob() }));
    const body = await res.json();
    expect(languages).toEqual([null, 'ko']);
    expect(body).toMatchObject({ text: '네.', language: 'ko' });
  });

  it('rejects missing audio, oversized clips and long prompts', async () => {
    expect((await POST(request({ language: 'ko' }))).status).toBe(400);
    expect((await POST(request({ audio: wavBlob(2 * 1024 * 1024 + 1) }))).status).toBe(413);
    expect((await POST(request({ audio: wavBlob(), prompt: 'x'.repeat(201) }))).status).toBe(400);
    expect((await POST(request({ audio: wavBlob(), language: 'ja' }))).status).toBe(400);
  });

  it('hides upstream error bodies', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    server.use(
      http.post(`${SPEACHES}/audio/transcriptions`, () =>
        HttpResponse.text('boom: key=SECRET123', { status: 500 }),
      ),
    );
    const res = await POST(request({ audio: wavBlob() }));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain('upstream_error');
    expect(text).not.toContain('SECRET123');
    spy.mockRestore();
  });

  it('requires the access token when one is configured', async () => {
    vi.stubEnv('APP_ACCESS_TOKEN', 'letmein');
    resetEnvCache();
    expect((await POST(request({ audio: wavBlob() }))).status).toBe(401);
    expect((await POST(request({ audio: wavBlob() }, { 'x-nunchi-token': 'nope' }))).status).toBe(
      401,
    );

    server.use(
      http.post(`${SPEACHES}/audio/transcriptions`, () => HttpResponse.json(verbose('네.', 'ko'))),
    );
    const ok = await POST(request({ audio: wavBlob() }, { 'x-nunchi-token': 'letmein' }));
    expect(ok.status).toBe(200);
  });
});
