import { EngineError } from '@/lib/errors';
import type { EndpointSettings, EngineChoice } from '@/lib/settings/engine-settings';
import { getEndpointSettings, getEngineChoice } from '@/lib/settings/use-engine-settings';
import { endpointProvider } from './endpoint';
import { serverProvider } from './server';
import {
  ENGINE_IDS,
  ENGINE_TASKS,
  type EngineId,
  type EngineProvider,
  type EngineStatus,
  type Engines,
  type EngineTask,
} from './types';

/**
 * Stands in for an engine that isn't built yet (a choice saved by a newer version, or
 * edited by hand). Every call fails: work never quietly goes to the server instead, since
 * someone who picked on-device processing may not want their audio sent anywhere.
 */
function comingSoonProvider(id: EngineId, label: string): EngineProvider {
  const message = `${label} processing isn't available yet. Choose Server in Processing settings.`;
  const base = {
    id,
    needsNetwork: false,
    status: async (): Promise<EngineStatus> => ({ state: 'unavailable', reason: 'Coming soon.' }),
  };
  const fail = async (): Promise<never> => {
    throw new EngineError('unavailable', message, { engine: id });
  };
  return {
    id,
    label,
    built: false,
    speech: () => ({ ...base, transcribe: fail }),
    translate: () => ({ ...base, translate: fail }),
    summary: () => ({ ...base, summarize: fail }),
  };
}

/** Every engine the user can pick, by id. A new engine is one entry here. */
const PROVIDERS: Record<EngineId, EngineProvider> = {
  server: serverProvider,
  endpoint: endpointProvider,
  device: comingSoonProvider('device', 'This device'),
};

export const ENGINE_LABELS = Object.fromEntries(
  ENGINE_IDS.map((id) => [id, PROVIDERS[id].label]),
) as Record<EngineId, string>;

/** Engines that exist so far. The others are listed in settings as "coming soon". */
export const BUILT_ENGINES: ReadonlySet<EngineId> = new Set(
  ENGINE_IDS.filter((id) => PROVIDERS[id].built),
);

/** The engines for a given choice of engine per task (endpoints default to the saved ones). */
export function buildEngines(
  choice: EngineChoice,
  endpoints: EndpointSettings = getEndpointSettings(),
): Engines {
  return {
    speech: PROVIDERS[choice.speech].speech(endpoints),
    translate: PROVIDERS[choice.translate].translate(endpoints),
    summary: PROVIDERS[choice.summary].summary(endpoints),
  };
}

/** The engines currently chosen in settings. Read per job, so a change applies to the next line. */
export function getEngines(): Engines {
  return buildEngines(getEngineChoice(), getEndpointSettings());
}

/** The engine for one task, as currently chosen. */
export function getEngine<T extends EngineTask>(task: T): Engines[T] {
  return getEngines()[task];
}

/** Whether any chosen engine needs the network (drives the offline notice). */
export function needsNetwork(
  choice: EngineChoice,
  endpoints: EndpointSettings = getEndpointSettings(),
): boolean {
  const engines = buildEngines(choice, endpoints);
  return ENGINE_TASKS.some((task) => engines[task].needsNetwork);
}
