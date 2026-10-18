import { describe, expect, it } from 'vitest';
import { isConfigured, parseEnv } from '@/lib/server/env';

const valid = {
  SPEACHES_BASE_URL: 'https://stt.example.com/v1/',
  LLM_BASE_URL: 'https://llm.example.com/v1',
  LLM_MODEL: 'qwen',
};

describe('parseEnv', () => {
  it('applies defaults and trims trailing slashes', () => {
    const env = parseEnv(valid);
    expect(env.SPEACHES_BASE_URL).toBe('https://stt.example.com/v1');
    expect(env.SPEACHES_MODEL).toBe('Systran/faster-whisper-large-v3');
    expect(env.LLM_API_KEY).toBe('none');
    expect(env.APP_ACCESS_TOKEN).toBeUndefined();
  });

  it('treats blank optional values as unset', () => {
    const env = parseEnv({ ...valid, SPEACHES_API_KEY: '  ', APP_ACCESS_TOKEN: '' });
    expect(env.SPEACHES_API_KEY).toBeUndefined();
    expect(env.APP_ACCESS_TOKEN).toBeUndefined();
  });

  it('leaves an upstream unset when its variables are empty', () => {
    const env = parseEnv({});
    expect(env.SPEACHES_BASE_URL).toBeUndefined();
    expect(env.LLM_BASE_URL).toBeUndefined();
    expect(isConfigured('speaches', env)).toBe(false);
    expect(isConfigured('llm', env)).toBe(false);
    expect(isConfigured('speaches', parseEnv(valid))).toBe(true);
    expect(isConfigured('llm', parseEnv(valid))).toBe(true);
  });

  it('fails with a readable message on a bad URL or an LLM URL without a model', () => {
    expect(() => parseEnv({ SPEACHES_BASE_URL: 'not a url' })).toThrow(
      /Invalid server environment[\s\S]*SPEACHES_BASE_URL/,
    );
    expect(() => parseEnv({ LLM_BASE_URL: 'https://llm.example.com/v1' })).toThrow(
      /LLM_BASE_URL and LLM_MODEL must be set together/,
    );
    expect(() => parseEnv({ LLM_MODEL: 'qwen' })).toThrow(/LLM_MODEL/);
  });

  it('requires the custom header name and value together', () => {
    expect(() => parseEnv({ ...valid, LLM_HEADER_NAME: 'x-key' })).toThrow(/LLM_HEADER_NAME/);
    expect(
      parseEnv({ ...valid, LLM_HEADER_NAME: 'x-key', LLM_HEADER_VALUE: 'v' }).LLM_HEADER_NAME,
    ).toBe('x-key');
  });
});
