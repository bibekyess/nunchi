import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { EngineError } from '@/lib/errors';

describe('EngineError', () => {
  it('retries network, timeout and upstream failures by default', () => {
    expect(new EngineError('network', 'x').retryable).toBe(true);
    expect(new EngineError('timeout', 'x').retryable).toBe(true);
    expect(new EngineError('upstream', 'x').retryable).toBe(true);
    expect(new EngineError('auth', 'x').retryable).toBe(false);
    expect(new EngineError('bad_request', 'x').retryable).toBe(false);
    expect(new EngineError('unavailable', 'x').retryable).toBe(false);
    expect(new EngineError('auth', 'x', true).retryable).toBe(true);
  });
});

describe('ApiError', () => {
  it.each([
    [0, 'network', true],
    [401, 'auth', false],
    [400, 'bad_request', false],
    [408, 'timeout', true],
    [429, 'bad_request', true],
    [502, 'upstream', true],
    [504, 'timeout', true],
  ] as const)('status %i is %s, retryable %s', (status, kind, retryable) => {
    const err = new ApiError(status, 'code', 'message');
    expect(err).toBeInstanceOf(EngineError);
    expect(err.kind).toBe(kind);
    expect(err.retryable).toBe(retryable);
  });
});
