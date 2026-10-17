import { z } from 'zod';
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { ENGINE_IDS, ENGINE_TASKS, type EngineChoice } from '@/lib/engines/types';
import { readJson, writeJson } from '@/lib/storage';

// Per device, like the display preferences.
export type { EngineChoice };

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

const noSubscribe = () => () => {};

/**
 * The choice for rendering. Server rendering can't see localStorage, so the default is used
 * until hydration has finished; the saved choice follows right after.
 */
export function useEngineChoice(): EngineChoice {
  const hydrated = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  const choice = useEngineSettings((s) => s.choice);
  return hydrated ? choice : DEFAULT_ENGINE_CHOICE;
}

/** Non-React access for the pipeline. */
export const getEngineChoice = () => useEngineSettings.getState().choice;

// Another tab changed the choice: follow it, so both tabs send work to the same place.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === ENGINE_SETTINGS_KEY) useEngineSettings.setState({ choice: loadEngineChoice() });
  });
}
