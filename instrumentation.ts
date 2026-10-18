/**
 * Runs once when a Next.js server starts, before it takes requests: the configuration is
 * checked here so a misconfigured deployment stops at boot with a clear message, instead of
 * running and failing every request. Skipped while building, which needs no secrets, and on
 * the edge runtime, which has no API routes here.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const [{ checkEnvAtBoot }, { createLogger }] = await Promise.all([
    import('./lib/server/boot'),
    import('./lib/server/log'),
  ]);
  try {
    checkEnvAtBoot();
  } catch (err) {
    // Next would log this and keep serving 500s; stop instead.
    createLogger({ scope: 'boot' }).error('invalid configuration', {
      errMessage: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}
