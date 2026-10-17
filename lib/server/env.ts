import 'server-only';
import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const optionalUrl = optional.pipe(z.url().optional());

/** Drops trailing slashes so paths can be appended with `/`. */
const trimSlash = (url: string | undefined) => url?.replace(/\/+$/, '');

// Each upstream is optional: a deployment can leave speech or the LLM to custom endpoints or
// on-device models. A route whose upstream isn't set answers 503 `not_configured`.
export const envSchema = z
  .object({
    SPEACHES_BASE_URL: optionalUrl,
    SPEACHES_MODEL: z.string().min(1).default('Systran/faster-whisper-large-v3'),
    SPEACHES_API_KEY: optional,

    LLM_BASE_URL: optionalUrl,
    LLM_MODEL: optional,
    // The OpenAI SDK requires a string even when the server ignores it.
    LLM_API_KEY: optional.transform((v) => v ?? 'none'),
    LLM_HEADER_NAME: optional,
    LLM_HEADER_VALUE: optional,

    APP_ACCESS_TOKEN: optional,
  })
  .refine((e) => Boolean(e.LLM_BASE_URL) === Boolean(e.LLM_MODEL), {
    message:
      'LLM_BASE_URL and LLM_MODEL must be set together (leave both empty to turn the LLM off)',
    path: ['LLM_MODEL'],
  })
  .refine((e) => Boolean(e.LLM_HEADER_NAME) === Boolean(e.LLM_HEADER_VALUE), {
    message: 'LLM_HEADER_NAME and LLM_HEADER_VALUE must be set together',
    path: ['LLM_HEADER_NAME'],
  })
  .transform((e) => ({
    ...e,
    SPEACHES_BASE_URL: trimSlash(e.SPEACHES_BASE_URL),
    LLM_BASE_URL: trimSlash(e.LLM_BASE_URL),
  }));

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid server environment. Check .env.local:\n${problems}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Validated server env. Parsed on first use so `next build` works without secrets. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

export type Service = 'speaches' | 'llm';

/** Whether this server has the upstream for `service` set up. */
export function isConfigured(service: Service, env: Env = getEnv()): boolean {
  return service === 'speaches'
    ? Boolean(env.SPEACHES_BASE_URL)
    : Boolean(env.LLM_BASE_URL && env.LLM_MODEL);
}

/** Test hook. */
export function resetEnvCache() {
  cached = undefined;
}
