import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { ACCESS_TOKEN_HEADER } from '@/lib/errors';
import { getEnv } from './env';
import { jsonError } from './http';

/** Returns a 401 response when APP_ACCESS_TOKEN is set and the request lacks it, else null. */
export function checkAccess(request: Request): Response | null {
  const expected = getEnv().APP_ACCESS_TOKEN;
  if (!expected) return null;
  const given = request.headers.get(ACCESS_TOKEN_HEADER) ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length === b.length && timingSafeEqual(a, b)) return null;
  return jsonError('unauthorized', 'Missing or wrong access token.');
}
