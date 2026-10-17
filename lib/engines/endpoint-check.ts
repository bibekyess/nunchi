// "Test connection" for a custom endpoint: tells a wrong URL, a CORS block, a refused key and
// a missing model apart, in words someone setting up a local server can act on.
import { hostOf } from '@/lib/core/openai-compatible';
import { EngineError } from '@/lib/errors';
import type { EndpointConfig } from '@/lib/settings/engines';
import { endpointClient, isLoopback } from './endpoint';

export type EndpointCheck =
  | { ok: true; message: string; models: string[]; warning?: string }
  | { ok: false; message: string; hint?: string; models?: string[] };

export interface CheckOptions {
  /** The page's protocol (`location.protocol`), to spot mixed content before trying. */
  pageProtocol?: string;
  signal?: AbortSignal;
  /** Test hook. */
  fetch?: typeof fetch;
}

/** Time for the 1-token test answer; a local model may need to load first. */
const CHAT_TEST_TIMEOUT_MS = 60_000;
const PROBE_TIMEOUT_MS = 5_000;

export const CORS_HINT =
  "Allow this site on the server: Ollama — set OLLAMA_ORIGINS to this site's address and restart it; LM Studio — turn on CORS in its server settings; vLLM — start it with --allowed-origins; anything else — check its CORS setting.";

/**
 * Whether anything answers at `url` at all. A `no-cors` request succeeds (with an unreadable
 * response) whenever the server answers, CORS or not, so a failure here means it's down or the
 * address is wrong, and a success after a failed normal request means CORS blocked it.
 */
async function reachable(url: string, doFetch: typeof fetch): Promise<boolean> {
  try {
    await doFetch(url, { mode: 'no-cors', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

async function explain(
  err: unknown,
  config: EndpointConfig,
  doFetch: typeof fetch,
  step: 'models' | 'chat',
): Promise<EndpointCheck> {
  const host = hostOf(config.baseUrl);
  if (!(err instanceof EngineError)) {
    return { ok: false, message: 'The test failed unexpectedly.' };
  }
  const status = (err as { status?: number }).status;
  switch (err.kind) {
    case 'network':
      if (await reachable(`${config.baseUrl}/models`, doFetch)) {
        return {
          ok: false,
          message: `${host} answered, but the browser blocked it: the server doesn't allow this site (CORS).`,
          hint: CORS_HINT,
        };
      }
      return {
        ok: false,
        message: `Couldn't reach ${host}. Is the server running, and is the URL right?`,
      };
    case 'auth':
      return { ok: false, message: `${host} refused the API key (${status ?? 401}).` };
    case 'timeout':
      return {
        ok: false,
        message:
          step === 'chat'
            ? `${host} didn't answer in time. A local model may still be loading; try again.`
            : `${host} didn't answer within 5 seconds.`,
      };
    default:
      if (status === 404) {
        return step === 'chat'
          ? { ok: false, message: `${host} has no model named “${config.model}”.` }
          : {
              ok: false,
              message: `Nothing at ${config.baseUrl}/models. OpenAI-compatible URLs usually end in /v1.`,
            };
      }
      return { ok: false, message: err.message };
  }
}

/** Checks a (sanitized) endpoint config for speech (`speech`) or translation/summary (`chat`). */
export async function checkEndpoint(
  config: EndpointConfig,
  kind: 'speech' | 'chat',
  { pageProtocol, signal, fetch: doFetch = (i, init) => fetch(i, init) }: CheckOptions = {},
): Promise<EndpointCheck> {
  if (!config.baseUrl) {
    return { ok: false, message: 'Enter a full URL starting with http:// or https://.' };
  }
  if (
    pageProtocol === 'https:' &&
    new URL(config.baseUrl).protocol === 'http:' &&
    !isLoopback(config.baseUrl)
  ) {
    return {
      ok: false,
      message:
        'This page is on https://, so the browser blocks plain http:// to other machines (mixed content).',
      hint: 'Serve that endpoint over https://, or run it on this computer and use localhost.',
    };
  }

  const client = endpointClient(config, kind, doFetch);

  let models: string[];
  try {
    models = await client.listModels({ signal });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    return explain(err, config, doFetch, 'models');
  }

  const count = `${models.length} model${models.length === 1 ? '' : 's'}`;
  if (!config.model) {
    return { ok: false, message: `Connected (${count}). Now pick a model.`, models };
  }
  const listed = models.length === 0 || models.includes(config.model);
  const warning = listed
    ? undefined
    : `“${config.model}” isn't in the server's model list; some servers load models on demand.`;

  if (kind === 'speech') {
    return { ok: true, message: `Connected (${count}).`, models, warning };
  }
  try {
    await client.chat.complete([{ role: 'user', content: 'Reply with OK.' }], {
      temperature: 0,
      maxTokens: 1,
      signal,
      timeoutMs: CHAT_TEST_TIMEOUT_MS,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    return { ...(await explain(err, config, doFetch, 'chat')), models };
  }
  return { ok: true, message: `Connected. ${config.model} answered.`, models };
}
