import { connection } from 'next/server';
import type { HealthStatus } from '@/lib/api/contract';
import { checkAccess } from '@/lib/server/auth';
import { isConfigured, type Service } from '@/lib/server/env';
import { errorResponse } from '@/lib/server/http';
import { pingLlm } from '@/lib/server/llm';
import { withRequestLog } from '@/lib/server/log';
import { pingSpeaches } from '@/lib/server/speaches';

export const GET = withRequestLog('health', async (request, log) => {
  await connection(); // always run at request time, never prerendered
  try {
    const denied = checkAccess(request);
    if (denied) return denied;

    const check = async (service: Service, ping: () => Promise<boolean>) =>
      !isConfigured(service) ? 'not_configured' : (await ping()) ? 'ok' : 'error';
    const [speaches, llm] = await Promise.all([
      check('speaches', pingSpeaches),
      check('llm', pingLlm),
    ]);
    return Response.json({ speaches, llm } satisfies HealthStatus, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return errorResponse(log, err);
  }
});
