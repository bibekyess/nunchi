import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ENDPOINTS,
  DEFAULT_ENGINE_CHOICE,
  ENGINE_SETTINGS_KEY,
  endpointFor,
  endpointProblem,
  loadEngineChoice,
  loadEngineSettings,
  sanitizeEndpoint,
  sanitizeEngineChoice,
  sanitizeEngineSettings,
} from '@/lib/settings/engine-settings';
import { useEngineSettings } from '@/lib/settings/use-engine-settings';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe('engine settings', () => {
  it('defaults every task to the server', () => {
    expect(DEFAULT_ENGINE_CHOICE).toEqual({
      speech: 'server',
      translate: 'server',
      summary: 'server',
    });
    expect(loadEngineChoice()).toEqual(DEFAULT_ENGINE_CHOICE);
  });

  it('keeps valid choices and resets unknown or broken ones', () => {
    expect(sanitizeEngineChoice({ speech: 'device', translate: 'cloud', extra: 1 })).toEqual({
      speech: 'device',
      translate: 'server',
      summary: 'server',
    });
    expect(sanitizeEngineChoice(null)).toEqual(DEFAULT_ENGINE_CHOICE);
    expect(sanitizeEngineChoice('server')).toEqual(DEFAULT_ENGINE_CHOICE);
  });

  it('saves a choice so it survives a reload', () => {
    useEngineSettings.getState().setChoice({ ...DEFAULT_ENGINE_CHOICE, summary: 'endpoint' });
    expect(useEngineSettings.getState().choice.summary).toBe('endpoint');
    expect(JSON.parse(localStorage.getItem(ENGINE_SETTINGS_KEY)!)).toMatchObject({
      choice: { summary: 'endpoint' },
    });
    expect(loadEngineChoice().summary).toBe('endpoint');
  });

  it('falls back to defaults when stored data is corrupt', () => {
    localStorage.setItem(ENGINE_SETTINGS_KEY, '{oops');
    expect(loadEngineChoice()).toEqual(DEFAULT_ENGINE_CHOICE);
  });
});

describe('endpoint settings', () => {
  const ollama = {
    baseUrl: 'http://localhost:11434/v1/',
    model: 'qwen3:4b',
    apiKey: '',
    headerName: '',
    headerValue: '',
    disableThinking: false,
  };

  it('reads the Phase 1 flat choice as the choice, with default endpoints', () => {
    localStorage.setItem(
      ENGINE_SETTINGS_KEY,
      JSON.stringify({ speech: 'server', translate: 'endpoint', summary: 'server' }),
    );
    expect(loadEngineSettings()).toEqual({
      choice: { speech: 'server', translate: 'endpoint', summary: 'server' },
      endpoints: DEFAULT_ENDPOINTS,
    });
  });

  it('defaults to empty endpoints, with the summary sharing the translation one', () => {
    expect(loadEngineSettings().endpoints).toEqual(DEFAULT_ENDPOINTS);
    expect(DEFAULT_ENDPOINTS.summary.sameAsTranslate).toBe(true);
  });

  it('keeps only http(s) URLs and drops trailing slashes', () => {
    expect(sanitizeEndpoint(ollama).baseUrl).toBe('http://localhost:11434/v1');
    expect(sanitizeEndpoint({ baseUrl: 'https://gpu.example.com/v1' }).baseUrl).toBe(
      'https://gpu.example.com/v1',
    );
    for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'not a url', 42, null]) {
      expect(sanitizeEndpoint({ baseUrl: bad }).baseUrl).toBe('');
    }
  });

  it('drops an invalid or half-filled custom header and line breaks in secrets', () => {
    expect(sanitizeEndpoint({ headerName: 'x-key', headerValue: 'v' })).toMatchObject({
      headerName: 'x-key',
      headerValue: 'v',
    });
    expect(sanitizeEndpoint({ headerName: 'bad header', headerValue: 'v' }).headerName).toBe('');
    expect(sanitizeEndpoint({ headerName: 'x-key', headerValue: '' }).headerName).toBe('');
    expect(sanitizeEndpoint({ apiKey: 'sk\r\nInjected: 1' }).apiKey).toBe('skInjected: 1');
  });

  it('resets unknown fields and types to defaults', () => {
    const s = sanitizeEngineSettings({
      choice: { speech: 'endpoint' },
      endpoints: { translate: { ...ollama, disableThinking: 'yes', extra: 1 }, summary: 'x' },
    });
    expect(s.choice).toEqual({ ...DEFAULT_ENGINE_CHOICE, speech: 'endpoint' });
    expect(s.endpoints.translate).toEqual({ ...ollama, baseUrl: 'http://localhost:11434/v1' });
    expect(s.endpoints.summary.sameAsTranslate).toBe(true);
    expect(s.endpoints.speech).toEqual(DEFAULT_ENDPOINTS.speech);
  });

  it('saves endpoints with the choice', () => {
    useEngineSettings.getState().setSettings({
      choice: { ...DEFAULT_ENGINE_CHOICE, translate: 'endpoint' },
      endpoints: { ...DEFAULT_ENDPOINTS, translate: ollama },
    });
    expect(loadEngineSettings().endpoints.translate.model).toBe('qwen3:4b');
    expect(useEngineSettings.getState().endpoints.translate.baseUrl).toBe(
      'http://localhost:11434/v1',
    );
  });

  it('lets the summary borrow the translation endpoint', () => {
    const endpoints = { ...DEFAULT_ENDPOINTS, translate: ollama };
    expect(endpointFor(endpoints, 'summary')).toBe(ollama);
    const own = { ...ollama, model: 'qwen3:14b', sameAsTranslate: false };
    expect(endpointFor({ ...endpoints, summary: own }, 'summary')).toBe(own);
    expect(endpointFor(endpoints, 'speech')).toBe(endpoints.speech);
  });

  it('says what is missing before an endpoint can be used', () => {
    expect(endpointProblem(DEFAULT_ENDPOINTS.speech)).toBe('Enter the server URL.');
    expect(endpointProblem({ ...ollama, model: '' })).toBe('Enter a model.');
    expect(endpointProblem(ollama)).toBeNull();
  });

  // Review finding I: a custom header that saving would drop must block saving instead.
  it('flags a custom header that would be dropped, instead of dropping it silently', () => {
    expect(endpointProblem({ ...ollama, headerName: 'x api key', headerValue: 'v' })).toMatch(
      /header name/,
    );
    expect(endpointProblem({ ...ollama, headerName: 'x-api-key', headerValue: '' })).toMatch(
      /header value/,
    );
    expect(endpointProblem({ ...ollama, headerName: '', headerValue: 'v' })).toMatch(/header name/);
    expect(endpointProblem({ ...ollama, headerName: 'x-api-key', headerValue: 'v' })).toBeNull();
  });
});
