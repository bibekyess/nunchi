// Which engine does each task, and the custom endpoints, as stored on this device. Pure: no
// React, no stores and nothing that runs on import, so a worker can use it too. The live
// store and hooks are in `use-engine-settings.ts`.
//
// Per device, like the display preferences. Endpoint keys live here too: they never leave this
// browser except in requests to the endpoint itself.
import { ENGINE_IDS, ENGINE_TASKS, type EngineChoice, type EngineTask } from '@/lib/engines/ids';
import { readJson, writeJson } from '@/lib/browser/storage';

export type { EngineChoice };

export const ENGINE_SETTINGS_KEY = 'nunchi.engines';

export const DEFAULT_ENGINE_CHOICE: EngineChoice = {
  speech: 'server',
  translate: 'server',
  summary: 'server',
};

/** An OpenAI-compatible server the browser calls directly. Empty strings mean "not set". */
export interface EndpointConfig {
  /** e.g. `http://localhost:11434/v1`. Only http(s). */
  baseUrl: string;
  model: string;
  /** Sent as `Authorization: Bearer …` when set. */
  apiKey: string;
  /** Optional extra header (e.g. a gateway's auth header); both parts or neither. */
  headerName: string;
  headerValue: string;
  /** Sends vLLM's `chat_template_kwargs.enable_thinking=false` (Qwen3). Chat only. */
  disableThinking: boolean;
}

export interface SummaryEndpointConfig extends EndpointConfig {
  /** Use the translation endpoint for summaries too. */
  sameAsTranslate: boolean;
}

export interface EndpointSettings {
  speech: EndpointConfig;
  translate: EndpointConfig;
  summary: SummaryEndpointConfig;
}

export interface EngineSettings {
  choice: EngineChoice;
  endpoints: EndpointSettings;
}

export const EMPTY_ENDPOINT: EndpointConfig = {
  baseUrl: '',
  model: '',
  apiKey: '',
  headerName: '',
  headerValue: '',
  disableThinking: false,
};

export const DEFAULT_ENDPOINTS: EndpointSettings = {
  speech: { ...EMPTY_ENDPOINT },
  translate: { ...EMPTY_ENDPOINT },
  summary: { ...EMPTY_ENDPOINT, sameAsTranslate: true },
};

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  choice: DEFAULT_ENGINE_CHOICE,
  endpoints: DEFAULT_ENDPOINTS,
};

const asRecord = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

const isEngineId = (value: unknown): value is EngineChoice[EngineTask] =>
  (ENGINE_IDS as readonly unknown[]).includes(value);

/** Keeps every valid task choice; anything missing, unknown or hand-edited falls back to the default. */
export function sanitizeEngineChoice(raw: unknown): EngineChoice {
  const stored = asRecord(raw);
  const choice = { ...DEFAULT_ENGINE_CHOICE };
  for (const task of ENGINE_TASKS) {
    const value = stored[task];
    if (isEngineId(value)) choice[task] = value;
  }
  return choice;
}

/** An http(s) URL without trailing slashes, or '' when it isn't one. */
export function cleanBaseUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  } catch {
    return '';
  }
  return trimmed.replace(/\/+$/, '');
}

// RFC 9110 token characters, so a header name can never break the request.
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Fields of an endpoint config that can be wrong. */
export type EndpointField = 'baseUrl' | 'model' | 'headerName' | 'headerValue';

export interface EndpointIssue {
  field: EndpointField;
  message: string;
}

/**
 * Everything that keeps an endpoint config (as typed, or as stored) from being saved and
 * used, in field order; empty when it is ready. The one rule set for the dialog, the engines
 * and saving: `sanitizeEndpoint` only drops what this reports.
 */
export function endpointIssues(config: EndpointConfig): EndpointIssue[] {
  const issues: EndpointIssue[] = [];
  const url = config.baseUrl.trim();
  if (!url) issues.push({ field: 'baseUrl', message: 'Enter the server URL.' });
  else if (!cleanBaseUrl(url)) {
    issues.push({ field: 'baseUrl', message: 'Use a full URL starting with http:// or https://.' });
  }
  if (!config.model.trim()) issues.push({ field: 'model', message: 'Enter a model.' });
  const name = config.headerName.trim();
  const value = config.headerValue.trim();
  if (name && !HEADER_NAME.test(name)) {
    issues.push({
      field: 'headerName',
      message: 'The custom header name can only use letters, digits and - (no spaces).',
    });
  } else if (name && !value) {
    issues.push({
      field: 'headerValue',
      message: 'Enter the custom header value, or clear its name.',
    });
  } else if (!name && value) {
    issues.push({
      field: 'headerName',
      message: 'Enter the custom header name, or clear its value.',
    });
  }
  return issues;
}

/** The first thing keeping an endpoint from being used, or null when it is complete. */
export function endpointProblem(config: EndpointConfig): string | null {
  return endpointIssues(config)[0]?.message ?? null;
}

export function sanitizeEndpoint(raw: unknown): EndpointConfig {
  const r = asRecord(raw);
  const headerName = text(r.headerName, 100);
  // Header values can't hold line breaks; drop any rather than send a broken request.
  const headerValue = text(r.headerValue, 1000).replace(/[\r\n]/g, '');
  // Only reached by hand-edited or old data: the dialog won't save a header with issues.
  const header = HEADER_NAME.test(headerName) && headerValue !== '';
  return {
    baseUrl: cleanBaseUrl(r.baseUrl),
    model: text(r.model, 200),
    apiKey: text(r.apiKey, 1000).replace(/[\r\n]/g, ''),
    headerName: header ? headerName : '',
    headerValue: header ? headerValue : '',
    disableThinking: r.disableThinking === true,
  };
}

export function sanitizeEngineSettings(raw: unknown): EngineSettings {
  const stored = asRecord(raw);
  // Phase 1 stored the choice itself: { speech, translate, summary }.
  const isFlat = !('choice' in stored) && ENGINE_TASKS.some((t) => t in stored);
  const endpoints = asRecord(stored.endpoints);
  const summary = asRecord(endpoints.summary);
  return {
    choice: sanitizeEngineChoice(isFlat ? stored : stored.choice),
    endpoints: {
      speech: sanitizeEndpoint(endpoints.speech),
      translate: sanitizeEndpoint(endpoints.translate),
      summary: {
        ...sanitizeEndpoint(summary),
        sameAsTranslate: summary.sameAsTranslate !== false,
      },
    },
  };
}

/** The endpoint a task actually uses (summary may borrow the translation one). */
export function endpointFor(endpoints: EndpointSettings, task: EngineTask): EndpointConfig {
  if (task === 'summary' && endpoints.summary.sameAsTranslate) return endpoints.translate;
  return endpoints[task];
}

/** Whether the endpoint `task` would use differs between two sets of settings. */
export function endpointChanged(
  a: EndpointSettings,
  b: EndpointSettings,
  task: EngineTask,
): boolean {
  const x = endpointFor(a, task);
  const y = endpointFor(b, task);
  return (Object.keys(EMPTY_ENDPOINT) as (keyof EndpointConfig)[]).some((k) => x[k] !== y[k]);
}

export function loadEngineSettings(): EngineSettings {
  return readJson(ENGINE_SETTINGS_KEY, sanitizeEngineSettings);
}

export function loadEngineChoice(): EngineChoice {
  return loadEngineSettings().choice;
}

/** Saves settings as they will be used (sanitized), and returns that. */
export function saveEngineSettings(settings: EngineSettings): EngineSettings {
  const clean = sanitizeEngineSettings(settings);
  writeJson(ENGINE_SETTINGS_KEY, clean);
  return clean;
}
