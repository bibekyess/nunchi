import { getEngineChoice, type EngineChoice } from '@/lib/settings/engines';
import { EngineError } from '@/lib/errors';
import { serverSpeech, serverSummary, serverTranslate } from './server';
import {
  ENGINE_TASKS,
  type EngineId,
  type EngineStatus,
  type Engines,
  type EngineTask,
  type SpeechEngine,
  type SummaryEngine,
  type TranslateEngine,
} from './types';

export const ENGINE_LABELS: Record<EngineId, string> = {
  server: 'Server',
  endpoint: 'Custom',
  device: 'This device',
};

/** Engines that exist so far. The others are listed in settings as "coming soon". */
export const BUILT_ENGINES: ReadonlySet<EngineId> = new Set<EngineId>(['server']);

const SERVER: Engines = {
  speech: serverSpeech,
  translate: serverTranslate,
  summary: serverSummary,
};

/**
 * Stands in for an engine that isn't built yet (a choice saved by a newer version, or
 * edited by hand). Every call fails: work never quietly goes to the server instead, since
 * someone who picked on-device processing may not want their audio sent anywhere.
 */
function notBuilt(id: EngineId) {
  const message = `${ENGINE_LABELS[id]} processing isn't available yet. Choose Server in Processing settings.`;
  const status = async (): Promise<EngineStatus> => ({
    state: 'unavailable',
    reason: 'Coming soon.',
  });
  const fail = async (): Promise<never> => {
    throw new EngineError('unavailable', message, { engine: id });
  };
  return { id, needsNetwork: false, status, fail };
}

function speechFor(id: EngineId): SpeechEngine {
  if (id === 'server') return SERVER.speech;
  const { fail, ...base } = notBuilt(id);
  return { ...base, transcribe: fail };
}

function translateFor(id: EngineId): TranslateEngine {
  if (id === 'server') return SERVER.translate;
  const { fail, ...base } = notBuilt(id);
  return { ...base, translate: fail };
}

function summaryFor(id: EngineId): SummaryEngine {
  if (id === 'server') return SERVER.summary;
  const { fail, ...base } = notBuilt(id);
  return { ...base, summarize: fail };
}

/** The engines for a given choice of engine per task. */
export function buildEngines(choice: EngineChoice): Engines {
  return {
    speech: speechFor(choice.speech),
    translate: translateFor(choice.translate),
    summary: summaryFor(choice.summary),
  };
}

/** The engines currently chosen in settings. Read per job, so a change applies to the next line. */
export function getEngines(): Engines {
  return buildEngines(getEngineChoice());
}

/** The engine for one task, as currently chosen. */
export function getEngine<T extends EngineTask>(task: T): Engines[T] {
  return getEngines()[task];
}

/** Whether any chosen engine needs the network (drives the offline notice). */
export function needsNetwork(choice: EngineChoice): boolean {
  const engines = buildEngines(choice);
  return ENGINE_TASKS.some((task) => engines[task].needsNetwork);
}
