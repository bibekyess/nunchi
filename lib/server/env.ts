import 'server-only';
import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

export const envSchema = z
  .object({
    SPEACHES_BASE_URL: z.url(),
    SPEACHES_MODEL: z.string().min(1).default('Systran/faster-whisper-large-v3'),
    SPEACHES_API_KEY: optional,

    LLM_BASE_URL: z.url(),
    LLM_MODEL: z.string().min(1),
    // The OpenAI SDK requires a string even when the server ignores it.
    LLM_API_KEY: optional.transform((v) => v ?? 'none'),
    LLM_HEADER_NAME: optional,
    LLM_HEADER_VALUE: optional,

    APP_ACCESS_TOKEN: optional,
  })
  .refine((e) => Boolean(e.LLM_HEADER_NAME) === Boolean(e.LLM_HEADER_VALUE), {
    message: 'LLM_HEADER_NAME and LLM_HEADER_VALUE must be set together',
    path: ['LLM_HEADER_NAME'],
  })
  .transform((e) => ({
    ...e,
    SPEACHES_BASE_URL: e.SPEACHES_BASE_URL.replace(/\/+$/, ''),
    LLM_BASE_URL: e.LLM_BASE_URL.replace(/\/+$/, ''),
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

/** Test hook. */
export function resetEnvCache() {
  cached = undefined;
}
