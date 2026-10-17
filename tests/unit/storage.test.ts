import { afterEach, describe, expect, it, vi } from 'vitest';
import { readJson, readString, writeJson, writeString } from '@/lib/storage';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('storage', () => {
  it('reads back what it wrote, and null removes', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    writeString('k', 'v');
    expect(readString('k')).toBe('v');
    writeString('k', null);
    expect(readString('k')).toBeNull();
  });

  it('passes JSON through the sanitizer, with null for missing or corrupt data', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const sanitize = vi.fn((raw: unknown) => (typeof raw === 'number' ? raw : 0));
    writeJson('n', 7);
    expect(readJson('n', sanitize)).toBe(7);
    expect(readJson('missing', sanitize)).toBe(0);
    writeString('bad', '{not json');
    expect(readJson('bad', sanitize)).toBe(0);
    expect(sanitize).toHaveBeenLastCalledWith(null);
  });

  it('falls back quietly when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(readString('k')).toBeNull();
    expect(() => writeString('k', 'v')).not.toThrow();
    expect(readJson('k', () => 'fallback')).toBe('fallback');
  });
});
