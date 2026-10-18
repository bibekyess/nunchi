import { connection } from 'next/server';

/**
 * Liveness for the container healthcheck: answers as long as the server is up. No passcode
 * and no upstream calls, unlike /api/health.
 */
export async function GET() {
  await connection(); // always answered by the running server, never prerendered
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
