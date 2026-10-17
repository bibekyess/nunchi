import { afterEach, describe, expect, it, vi } from 'vitest';
import { endpointSpeech, endpointTranslate, isLoopback } from '@/lib/engines/endpoint';
import type { TranslateRequest } from '@/lib/engines/types';
import { EngineError } from '@/lib/errors';
import { EMPTY_ENDPOINT } from '@/lib/settings/engines';

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
