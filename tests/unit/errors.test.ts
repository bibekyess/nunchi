import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/engines/server';
import { EngineError } from '@/lib/errors';

describe('EngineError', () => {
  it('retries network, timeout and upstream failures by default', () => {
    expect(new EngineError('network', 'x').retryable).toBe(true);
    expect(new EngineError('timeout', 'x').retryable).toBe(true);
    expect(new EngineError('upstream', 'x').retryable).toBe(true);
    expect(new EngineError('auth', 'x').retryable).toBe(false);
    expect(new EngineError('bad_request', 'x').retryable).toBe(false);
    expect(new EngineError('unavailable', 'x').retryable).toBe(false);
    expect(new EngineError('auth', 'x', { retryable: true }).retryable).toBe(true);
  });

  it('asks for the passcode only on server auth errors', () => {
    expect(new EngineError('auth', 'x', { engine: 'server' }).needsPasscode).toBe(true);
    expect(new EngineError('auth', 'x', { engine: 'endpoint' }).needsPasscode).toBe(false);
    expect(new EngineError('auth', 'x').needsPasscode).toBe(false);
    expect(new EngineError('upstream', 'x', { engine: 'server' }).needsPasscode).toBe(false);
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
    expect(err.engine).toBe('server');
    expect(err.kind).toBe(kind);
    expect(err.retryable).toBe(retryable);
  });

  it('treats a server without the upstream as unavailable, not worth retrying', () => {
    const err = new ApiError(503, 'not_configured', 'Speech-to-text is not set up on this server.');
    expect(err.kind).toBe('unavailable');
    expect(err.retryable).toBe(false);
  });
});
