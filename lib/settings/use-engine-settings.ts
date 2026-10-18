// The live engine settings: a store the UI and the pipeline read, and hooks for rendering.
// What is stored, and how it is checked, is in `engine-settings.ts`.
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import {
  DEFAULT_ENDPOINTS,
  DEFAULT_ENGINE_CHOICE,
  ENGINE_SETTINGS_KEY,
  loadEngineSettings,
  saveEngineSettings,
  type EndpointSettings,
  type EngineChoice,
  type EngineSettings,
} from './engine-settings';

interface EngineSettingsState extends EngineSettings {
  setChoice: (choice: EngineChoice) => void;
  setSettings: (settings: EngineSettings) => void;
}

export const useEngineSettings = create<EngineSettingsState>()((set, get) => ({
  ...loadEngineSettings(),
  setChoice: (choice) => get().setSettings({ choice, endpoints: get().endpoints }),
  setSettings: (settings) => set(saveEngineSettings(settings)),
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
