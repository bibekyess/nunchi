// Review finding E: the server checks its config once at startup (fail fast) and warns when a
// production deployment with upstreams has no passcode.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkEnvAtBoot } from '@/lib/server/boot';
import { resetEnvCache } from '@/lib/server/env';

const upstreams = {
  SPEACHES_BASE_URL: 'https://stt.example.com/v1',
  LLM_BASE_URL: 'https://llm.example.com/v1',
  LLM_MODEL: 'qwen',
};

function boot(env: Record<string, string>, nodeEnv: string) {
  vi.unstubAllEnvs();
  for (const key of [
    'SPEACHES_BASE_URL',
    'LLM_BASE_URL',
    'LLM_MODEL',
    'APP_ACCESS_TOKEN',
    'LLM_HEADER_NAME',
    'LLM_HEADER_VALUE',
  ]) {
    vi.stubEnv(key, '');
  }
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.stubEnv('NODE_ENV', nodeEnv);
  resetEnvCache();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    checkEnvAtBoot();
    return warn.mock.calls.flat().join(' ');
  } finally {
    warn.mockRestore();
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe('checkEnvAtBoot', () => {
  it('fails with the clear message when the environment is invalid', () => {
    expect(() => boot({ LLM_BASE_URL: 'https://llm.example.com/v1' }, 'production')).toThrow(
      /Invalid server environment[\s\S]*LLM_MODEL/,
    );
  });

  it('warns in production when the upstreams have no passcode in front of them', () => {
    expect(boot(upstreams, 'production')).toMatch(/APP_ACCESS_TOKEN is not set/);
  });

  it('stays quiet with a passcode, in development, or with no upstreams to protect', () => {
    expect(boot({ ...upstreams, APP_ACCESS_TOKEN: 'secret' }, 'production')).toBe('');
    expect(boot(upstreams, 'development')).toBe('');
    expect(boot({}, 'production')).toBe('');
  });
});
