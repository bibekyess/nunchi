import { describe, expect, it } from 'vitest';
import { TOKEN_TTL_MS, issueToken, verifyToken } from '@/lib/server/auth';

const NOW = 1_760_000_000_000;

describe('access tokens', () => {
  it('accepts a token until it expires', () => {
    const { token, expiresAt } = issueToken('secret', NOW);
    expect(expiresAt).toBe(NOW + TOKEN_TTL_MS);
    expect(token).not.toContain('secret');
    expect(verifyToken(token, 'secret', NOW)).toBe(true);
    expect(verifyToken(token, 'secret', expiresAt - 1)).toBe(true);
    expect(verifyToken(token, 'secret', expiresAt)).toBe(false);
  });

  it('rejects a token signed with another passcode', () => {
    const { token } = issueToken('old', NOW);
    expect(verifyToken(token, 'new', NOW)).toBe(false);
  });

  it('rejects a token whose expiry was changed', () => {
    const { token } = issueToken('secret', NOW);
    const [, sig] = token.split('.');
    expect(verifyToken(`${NOW + 10 * TOKEN_TTL_MS}.${sig}`, 'secret', NOW)).toBe(false);
  });

  it('rejects malformed tokens', () => {
    for (const bad of ['', 'secret', '.sig', 'abc.sig', `${NOW + 1000}.`, '-1.sig']) {
      expect(verifyToken(bad, 'secret', NOW)).toBe(false);
    }
  });
});
