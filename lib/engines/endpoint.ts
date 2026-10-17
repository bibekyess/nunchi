// The `endpoint` engine: an OpenAI-compatible server the user entered (Speaches, Ollama,
// LM Studio, vLLM, …), called straight from the browser. URLs and keys never go to the
// app's own /api/*; the shared pipeline logic in lib/core runs here instead of on the server.
import { createOpenAICompatible, VLLM_NO_THINKING } from '@/lib/core/openai-compatible';
import { startSummary, summaryLines } from '@/lib/core/summarize';
import { transcribeWithFallback } from '@/lib/core/transcribe';
import { runTranslation } from '@/lib/core/translate';
import { EngineError } from '@/lib/errors';
import { endpointProblem, type EndpointConfig } from '@/lib/settings/engines';
import type {
  EngineStatus,
  EngineTask,
  SpeechEngine,
  SummaryEngine,
  TranslateEngine,
} from './types';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Whether `baseUrl` points at this machine, so requests work without a connection. */
export function isLoopback(baseUrl: string): boolean {
  try {
    return LOOPBACK.has(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

const TASK_NAMES: Record<EngineTask, string> = {
  speech: 'speech to text',
  translate: 'translation',
  summary: 'summary',
};

function client(config: EndpointConfig, chat: boolean) {
  return createOpenAICompatible({
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey || undefined,
    headers:
      config.headerName && config.headerValue
        ? { [config.headerName]: config.headerValue }
        : undefined,
    extraBody: chat && config.disableThinking ? VLLM_NO_THINKING : undefined,
    engine: 'endpoint',
  });
}

/** Fails fast, without retries, when the task's endpoint isn't filled in. */
function requireComplete(config: EndpointConfig, task: EngineTask) {
  const problem = endpointProblem(config);
  if (problem) {
    throw new EngineError(
      'unavailable',
      `Custom ${TASK_NAMES[task]} isn't set up. ${problem} (Processing settings)`,
      { engine: 'endpoint' },
    );
  }
}

/** Points a refused key at the place to fix it; the app passcode is not involved. */
async function withHints<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof EngineError && err.kind === 'auth') {
      throw new EngineError('auth', `${err.message} Check the API key in Processing settings.`, {
        engine: 'endpoint',
        retryable: false,
      });
    }
    throw err;
  }
}

async function status(
  config: EndpointConfig,
  chat: boolean,
  signal?: AbortSignal,
): Promise<EngineStatus> {
  if (endpointProblem(config)) return { state: 'not_configured' };
  try {
    await client(config, chat).listModels({ signal });
    return { state: 'ready' };
  } catch (err) {
    if (err instanceof EngineError && err.kind === 'auth') {
      return { state: 'error', reason: 'The endpoint refused the API key.' };
    }
    return {
      state: 'error',
      reason: err instanceof Error ? err.message : 'The endpoint is not answering.',
    };
  }
}

export function endpointSpeech(config: EndpointConfig): SpeechEngine {
  return {
    id: 'endpoint',
    needsNetwork: !isLoopback(config.baseUrl),
    status: (signal) => status(config, false, signal),
    transcribe: (audio, opts) =>
      withHints(async () => {
        requireComplete(config, 'speech');
        const { result } = await transcribeWithFallback(client(config, false).speech, audio, opts);
        return result;
      }),
  };
}

export function endpointTranslate(config: EndpointConfig): TranslateEngine {
  return {
    id: 'endpoint',
    needsNetwork: !isLoopback(config.baseUrl),
    status: (signal) => status(config, true, signal),
    translate: (request, onDelta, signal) =>
      withHints(async () => {
        requireComplete(config, 'translate');
        return runTranslation(client(config, true).chat, request, onDelta, signal);
      }),
  };
}

export function endpointSummary(config: EndpointConfig): SummaryEngine {
  return {
    id: 'endpoint',
    needsNetwork: !isLoopback(config.baseUrl),
    status: (signal) => status(config, true, signal),
    summarize: (request, onDelta, signal) =>
      withHints(async () => {
        requireComplete(config, 'summary');
        const lines = summaryLines(request.utterances);
        if (lines.length === 0) {
          throw new EngineError('bad_request', 'The transcript is empty.', { engine: 'endpoint' });
        }
        const run = await startSummary(client(config, true).chat, request, lines, { signal });
        let full = '';
        for await (const piece of run.text) {
          full += piece;
          onDelta(piece);
        }
        return full;
      }),
  };
}
