import { unlockBodySchema, type UnlockResponse } from '@/lib/api/contract';
import { isPasscode, issueToken } from '@/lib/server/auth';
import { getEnv } from '@/lib/server/env';
import { errorResponse, jsonError, parseJsonBody } from '@/lib/server/http';
import { withRequestLog } from '@/lib/server/log';

const MAX_BODY_BYTES = 4 * 1024;

/** Exchanges the passcode for a signed token that expires, so the browser never stores it. */
export const POST = withRequestLog('unlock', async (request, log) => {
  try {
    const { data: input, error } = await parseJsonBody(request, unlockBodySchema, MAX_BODY_BYTES);
    if (error) return error;
    const expected = getEnv().APP_ACCESS_TOKEN;
    if (expected && !isPasscode(input.passcode, expected)) {
      return jsonError('unauthorized', 'Wrong passcode.');
    }
    const result: UnlockResponse = expected ? issueToken(expected) : { token: '', expiresAt: 0 };
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(log, err);
  }
});
