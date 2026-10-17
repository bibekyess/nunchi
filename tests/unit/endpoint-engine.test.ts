import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  endpointSpeech,
  endpointSummary,
  endpointTranslate,
  isLoopback,
} from '@/lib/engines/endpoint';
import type { TranslateRequest } from '@/lib/engines/types';
import { EngineError } from '@/lib/errors';
import { EMPTY_ENDPOINT } from '@/lib/settings/engines';
import { chatJson, chatStream } from '../integration/helpers';

afterEach(() => vi.unstubAllGlobals());

const config = { ...EMPTY_ENDPOINT, baseUrl: 'http://localhost:11434/v1', model: 'qwen3:4b' };
const request: TranslateRequest = {
  text: '안녕',
  sourceLang: 'ko',
  targetLang: 'en',
  context: [],
  glossary: [],
};

describe('endpoint engines', () => {
  it('treats only loopback hosts as local', () => {
    for (const url of [
      'http://localhost:8000/v1',
      'http://127.0.0.1:1234/v1',
      'http://[::1]:11434/v1',
    ]) {
      expect(isLoopback(url)).toBe(true);
    }
    for (const url of [
      'http://192.168.1.5:11434/v1',
      'https://gpu.example.com/v1',
      'http://localhost.evil.com/v1',
      '',
    ]) {
      expect(isLoopback(url)).toBe(false);
    }
  });

  it('reports an unfilled endpoint as not set up and fails its work without retrying', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const engine = endpointTranslate(EMPTY_ENDPOINT);
    expect(await engine.status()).toEqual({ state: 'not_configured' });
    const err = (await engine.translate(request, () => {}).catch((e: unknown) => e)) as EngineError;
    expect(err).toMatchObject({ kind: 'unavailable', retryable: false, engine: 'endpoint' });
    expect(err.message).toContain('Enter the server URL.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns a refused key into a hint about Processing settings, never the app passcode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 401 })),
    );
    const err = (await endpointTranslate({ ...config, apiKey: 'wrong' })
      .translate(request, () => {})
      .catch((e: unknown) => e)) as EngineError;
    expect(err).toBeInstanceOf(EngineError);
    expect(err.kind).toBe('auth');
    expect(err.needsPasscode).toBe(false);
    expect(err.retryable).toBe(false);
    expect(err.message).toContain('Check the API key in Processing settings.');
    expect(await endpointSpeech(config).status()).toEqual({
      state: 'error',
      reason: 'The endpoint refused the API key.',
    });
  });
});

describe('endpoint engines against an OpenAI-compatible server', () => {
  const BASE = 'http://gpu.test/v1';
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterAll(() => server.close());
  afterEach(() => server.resetHandlers());

  const remote = { ...EMPTY_ENDPOINT, baseUrl: BASE, model: 'm', apiKey: 'k' };

  it('transcribes as WAV and retries once in Korean when auto-detect lands elsewhere', async () => {
    const languages: (string | null)[] = [];
    server.use(
      http.post(`${BASE}/audio/transcriptions`, async ({ request }) => {
        const form = await request.formData();
        languages.push(form.get('language') as string | null);
        const file = form.get('file') as File;
        expect(new TextDecoder().decode((await file.arrayBuffer()).slice(0, 4))).toBe('RIFF');
        return HttpResponse.json(
          form.get('language')
            ? { text: '네.', language: 'ko', duration: 0.5 }
            : { text: 'ね。', language: 'japanese', duration: 0.5 },
        );
      }),
    );
    const result = await endpointSpeech(remote).transcribe(new Float32Array(8000), {
      language: 'auto',
    });
    expect(languages).toEqual([null, 'ko']);
    expect(result).toMatchObject({ text: '네.', language: 'ko' });
  });

  it('streams a translation with reasoning removed, retrying once when it comes back empty', async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/chat/completions`, async ({ request }) => {
        calls++;
        const body = (await request.json()) as { stream?: boolean };
        if (body.stream) return chatStream(['<think>\n\n</think>\n\n']); // nothing but reasoning
        return chatJson('Hello.');
      }),
    );
    const deltas: string[] = [];
    const text = await endpointTranslate(remote).translate(request, (d) => deltas.push(d));
    expect(text).toBe('Hello.');
    expect(deltas.join('')).toBe('Hello.');
    expect(calls).toBe(2);
  });

  it('streams a summary and rejects an empty transcript without calling the server', async () => {
    server.use(
      http.post(`${BASE}/chat/completions`, () => chatStream(['## Overview\n', 'Kiro sponsors.'])),
    );
    const summary = endpointSummary(remote);
    const base = { glossary: [], outputLang: 'en' as const };
    let streamed = '';
    const text = await summary.summarize(
      {
        ...base,
        utterances: [{ seq: 0, sourceText: '키로가 후원합니다', translation: 'Kiro sponsors.' }],
      },
      (d) => (streamed += d),
    );
    expect(text).toBe('## Overview\nKiro sponsors.');
    expect(streamed).toBe(text);

    const err = (await summary
      .summarize({ ...base, utterances: [{ seq: 0, sourceText: '  ' }] }, () => {})
      .catch((e: unknown) => e)) as EngineError;
    expect(err).toMatchObject({ kind: 'bad_request', message: 'The transcript is empty.' });
  });

  it('marks an unreachable endpoint as retryable network trouble', async () => {
    server.use(http.post(`${BASE}/chat/completions`, () => HttpResponse.error()));
    const err = (await endpointTranslate(remote)
      .translate(request, () => {})
      .catch((e: unknown) => e)) as EngineError;
    expect(err).toMatchObject({ kind: 'network', retryable: true, engine: 'endpoint' });
  });
});
