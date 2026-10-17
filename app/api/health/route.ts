import { connection } from 'next/server';
import { checkAccess } from '@/lib/server/auth';
import { isConfigured, type Service } from '@/lib/server/env';
import { errorResponse } from '@/lib/server/http';
import { pingLlm } from '@/lib/server/llm';
import { pingSpeaches } from '@/lib/server/speaches';

export async function GET(request: Request) {
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
    return Response.json({ speaches, llm }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse('health', err);
  }
}
