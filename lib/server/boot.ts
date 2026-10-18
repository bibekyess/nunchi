import 'server-only';
import { getEnv, isConfigured } from './env';
import { createLogger } from './log';

/**
 * Checks the server's configuration once, at startup (see instrumentation.ts): an invalid
 * environment throws the clear "Invalid server environment" message and the server doesn't
 * start, instead of failing on the first request. A production server with upstreams but no
 * passcode is reachable by anyone who finds it, so that gets a warning.
 */
export function checkEnvAtBoot(): void {
  const env = getEnv();
  const upstreams = isConfigured('speaches', env) || isConfigured('llm', env);
  if (process.env.NODE_ENV === 'production' && upstreams && !env.APP_ACCESS_TOKEN) {
    createLogger({ scope: 'boot' }).warn(
      'APP_ACCESS_TOKEN is not set: anyone who can reach this server can use its speech and LLM servers. Set it whenever the app is reachable from outside a trusted network.',
    );
  }
}

/**
 * Runs checkEnvAtBoot and stops the process on an invalid environment. Lives here rather than
 * in instrumentation.ts so the edge build of that file never sees process.exit.
 */
export function runBootCheck(): void {
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
