import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ACCESS_TOKEN_HEADER } from '@/lib/errors';
import { getEnv } from './env';
import { jsonError } from './http';

/** How long a token from /api/unlock stays valid. */
export const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sameText(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const sign = (secret: string, expiresAt: number) =>
  createHmac('sha256', secret).update(`nunchi-token:${expiresAt}`).digest('base64url');

/**
 * A token `<expiresAt>.<signature>` that stands in for the passcode, so browsers never store
 * the passcode itself. Signed with the passcode: changing APP_ACCESS_TOKEN revokes every token.
 */
export function issueToken(secret: string, now = Date.now()): { token: string; expiresAt: number } {
  const expiresAt = now + TOKEN_TTL_MS;
  return { token: `${expiresAt}.${sign(secret, expiresAt)}`, expiresAt };
}

/** Whether `token` was issued with `secret` and has not expired. */
export function verifyToken(token: string, secret: string, now = Date.now()): boolean {
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const stamp = token.slice(0, dot);
  if (!/^\d+$/.test(stamp)) return false;
  const expiresAt = Number(stamp);
  if (expiresAt <= now) return false;
  return sameText(token.slice(dot + 1), sign(secret, expiresAt));
}

/** Whether `given` is the passcode itself. */
export function isPasscode(given: string, expected: string): boolean {
  return sameText(given, expected);
}

/**
 * Returns a 401 response when APP_ACCESS_TOKEN is set and the request carries neither a valid
 * token nor the passcode itself (still accepted for scripts such as the smoke test), else null.
 */
export function checkAccess(request: Request): Response | null {
  const expected = getEnv().APP_ACCESS_TOKEN;
  if (!expected) return null;
  const given = request.headers.get(ACCESS_TOKEN_HEADER) ?? '';
  if (verifyToken(given, expected) || isPasscode(given, expected)) return null;
  return jsonError('unauthorized', 'Missing or wrong access token.');
}
