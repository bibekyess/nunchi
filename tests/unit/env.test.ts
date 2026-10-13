import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/lib/server/env';

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

  it('fails with a readable message when required values are missing', () => {
    expect(() => parseEnv({})).toThrow(/Invalid server environment[\s\S]*SPEACHES_BASE_URL/);
  });

  it('requires the custom header name and value together', () => {
    expect(() => parseEnv({ ...valid, LLM_HEADER_NAME: 'x-key' })).toThrow(/LLM_HEADER_NAME/);
    expect(
      parseEnv({ ...valid, LLM_HEADER_NAME: 'x-key', LLM_HEADER_VALUE: 'v' }).LLM_HEADER_NAME,
    ).toBe('x-key');
  });
});
