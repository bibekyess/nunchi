// Names of the engines and the tasks they do. A leaf module (no imports), so the layers below
// the engines (lib/types, lib/errors, lib/core, settings) can name them without depending on
// the engines themselves.

/**
 * The app's own server (`server`), an OpenAI-compatible URL the browser calls directly
 * (`endpoint`), or models running in the browser (`device`). The user picks one per task.
 */
export const ENGINE_IDS = ['server', 'endpoint', 'device'] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export const ENGINE_TASKS = ['speech', 'translate', 'summary'] as const;
export type EngineTask = (typeof ENGINE_TASKS)[number];

/** Which engine does each task. */
export type EngineChoice = Record<EngineTask, EngineId>;
