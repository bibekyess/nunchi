import { z } from 'zod';
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { ENGINE_IDS, ENGINE_TASKS, type EngineChoice, type EngineTask } from '@/lib/engines/types';
import { readJson, writeJson } from '@/lib/storage';

// Per device, like the display preferences. Endpoint keys live here too: they never leave this
// browser except in requests to the endpoint itself.
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

const engineId = z.enum(ENGINE_IDS);

const asRecord = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

/** Keeps every valid task choice; anything missing, unknown or hand-edited falls back to the default. */
export function sanitizeEngineChoice(raw: unknown): EngineChoice {
  const stored = asRecord(raw);
  const choice = { ...DEFAULT_ENGINE_CHOICE };
  for (const task of ENGINE_TASKS) {
    const parsed = engineId.safeParse(stored[task]);
    if (parsed.success) choice[task] = parsed.data;
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

export function sanitizeEndpoint(raw: unknown): EndpointConfig {
  const r = asRecord(raw);
  const headerName = text(r.headerName, 100);
  // Header values can't hold line breaks; drop any rather than send a broken request.
  const headerValue = text(r.headerValue, 1000).replace(/[\r\n]/g, '');
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

/** What is missing before a task can use its endpoint, or null when it is complete. */
export function endpointProblem(config: EndpointConfig): string | null {
  if (!config.baseUrl) return 'Enter the server URL.';
  if (!config.model) return 'Enter a model.';
  return null;
}

export function loadEngineSettings(): EngineSettings {
  return readJson(ENGINE_SETTINGS_KEY, sanitizeEngineSettings);
}

export function loadEngineChoice(): EngineChoice {
  return loadEngineSettings().choice;
}

interface EngineSettingsState extends EngineSettings {
  setChoice: (choice: EngineChoice) => void;
  setSettings: (settings: EngineSettings) => void;
}

export const useEngineSettings = create<EngineSettingsState>()((set, get) => ({
  ...loadEngineSettings(),
  setChoice: (choice) => get().setSettings({ choice, endpoints: get().endpoints }),
  setSettings: (settings) => {
    const clean = sanitizeEngineSettings(settings);
    writeJson(ENGINE_SETTINGS_KEY, clean);
    set(clean);
  },
}));

const noSubscribe = () => () => {};

/** False during server rendering and hydration, true after. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

/**
 * The choice for rendering. Server rendering can't see localStorage, so the default is used
 * until hydration has finished; the saved choice follows right after.
 */
export function useEngineChoice(): EngineChoice {
  const hydrated = useHydrated();
  const choice = useEngineSettings((s) => s.choice);
  return hydrated ? choice : DEFAULT_ENGINE_CHOICE;
}

/** Endpoint configs for rendering, defaults until hydration (see `useEngineChoice`). */
export function useEndpointSettings(): EndpointSettings {
  const hydrated = useHydrated();
  const endpoints = useEngineSettings((s) => s.endpoints);
  return hydrated ? endpoints : DEFAULT_ENDPOINTS;
}

/** Non-React access for the pipeline. */
export const getEngineChoice = () => useEngineSettings.getState().choice;
export const getEndpointSettings = () => useEngineSettings.getState().endpoints;

// Another tab changed the settings: follow it, so both tabs send work to the same place.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === ENGINE_SETTINGS_KEY) useEngineSettings.setState(loadEngineSettings());
  });
}
