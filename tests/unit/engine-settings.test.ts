import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ENGINE_CHOICE,
  ENGINE_SETTINGS_KEY,
  loadEngineChoice,
  sanitizeEngineChoice,
  useEngineSettings,
} from '@/lib/settings/engines';

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
      summary: 'endpoint',
    });
    expect(loadEngineChoice().summary).toBe('endpoint');
  });

  it('falls back to defaults when stored data is corrupt', () => {
    localStorage.setItem(ENGINE_SETTINGS_KEY, '{oops');
    expect(loadEngineChoice()).toEqual(DEFAULT_ENGINE_CHOICE);
  });
});
