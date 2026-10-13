import { connection } from 'next/server';
import { checkAccess } from '@/lib/server/auth';
import { errorResponse } from '@/lib/server/http';
import { pingLlm } from '@/lib/server/llm';
import { pingSpeaches } from '@/lib/server/speaches';

export async function GET(request: Request) {
  await connection(); // always run at request time, never prerendered
  try {
    const denied = checkAccess(request);
    if (denied) return denied;

    const [speaches, llm] = await Promise.all([pingSpeaches(), pingLlm()]);
    return Response.json(
      { speaches: speaches ? 'ok' : 'error', llm: llm ? 'ok' : 'error' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return errorResponse('health', err);
  }
}
