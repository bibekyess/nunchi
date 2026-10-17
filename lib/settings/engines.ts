import { z } from 'zod';
import { create } from 'zustand';
import { ENGINE_IDS, ENGINE_TASKS, type EngineId, type EngineTask } from '@/lib/engines/types';
import { readJson, writeJson } from '@/lib/storage';

/** Which engine does each task. Per device, like the display preferences. */
export type EngineChoice = Record<EngineTask, EngineId>;

export const ENGINE_SETTINGS_KEY = 'nunchi.engines';

export const DEFAULT_ENGINE_CHOICE: EngineChoice = {
  speech: 'server',
  translate: 'server',
  summary: 'server',
};

const engineId = z.enum(ENGINE_IDS);

/** Keeps every valid task choice; anything missing, unknown or hand-edited falls back to the default. */
export function sanitizeEngineChoice(raw: unknown): EngineChoice {
  const stored = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const choice = { ...DEFAULT_ENGINE_CHOICE };
  for (const task of ENGINE_TASKS) {
    const parsed = engineId.safeParse(stored[task]);
    if (parsed.success) choice[task] = parsed.data;
  }
  return choice;
}

export function loadEngineChoice(): EngineChoice {
  return readJson(ENGINE_SETTINGS_KEY, sanitizeEngineChoice);
}

interface EngineSettingsState {
  choice: EngineChoice;
  setChoice: (choice: EngineChoice) => void;
}

export const useEngineSettings = create<EngineSettingsState>()((set) => ({
  choice: loadEngineChoice(),
  setChoice: (choice) => {
    const clean = sanitizeEngineChoice(choice);
    writeJson(ENGINE_SETTINGS_KEY, clean);
    set({ choice: clean });
  },
}));

/** Non-React access for the pipeline. */
export const getEngineChoice = () => useEngineSettings.getState().choice;

// Another tab changed the choice: follow it, so both tabs send work to the same place.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === ENGINE_SETTINGS_KEY) useEngineSettings.setState({ choice: loadEngineChoice() });
  });
}
