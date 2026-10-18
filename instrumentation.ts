/**
 * Runs once when a Next.js server starts, before it takes requests: the configuration is
 * checked here so a misconfigured deployment stops at boot with a clear message, instead of
 * running and failing every request. Skipped while building, which needs no secrets, and on
 * the edge runtime, which has no API routes here.
 */
export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build'
  ) {
    const { runBootCheck } = await import('./lib/server/boot');
    runBootCheck();
  }
}
