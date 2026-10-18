// What the pipeline and summary need from whoever does the work: the app's own server
// (`server`), an OpenAI-compatible URL the browser calls directly (`endpoint`) or models
// running in the browser (`device`, Phase 3). The user picks one per task.
import type { Lang } from '@/lib/languages';
import type { EndpointSettings } from '@/lib/settings/engine-settings';
import type { GlossaryEntry, TranscriptionResult, TranslationContextItem } from '@/lib/types';
import type { EngineId } from './ids';

export { ENGINE_IDS, ENGINE_TASKS, type EngineChoice, type EngineId, type EngineTask } from './ids';

/** Whether an engine can take work right now. */
export type EngineStatus =
  | { state: 'ready' }
  /** The server has no upstream configured for this task. */
  | { state: 'not_configured' }
  /** It can't run here (not built yet, unsupported device). */
  | { state: 'unavailable'; reason: string }
  /** It should work but doesn't (server down, passcode needed). */
  | { state: 'error'; reason: string; needsPasscode?: boolean };

/** Only the app server's passcode is missing; on-device and custom engines never ask for it. */
export const isLocked = (status: EngineStatus | null): boolean =>
  status?.state === 'error' && status.needsPasscode === true;

interface EngineBase {
  readonly id: EngineId;
  /** Work waits for the connection while offline. False for on-device engines. */
  readonly needsNetwork: boolean;
  status(signal?: AbortSignal): Promise<EngineStatus>;
}

export interface TranscribeOptions {
  language: Lang | 'auto';
  prompt?: string;
  signal?: AbortSignal;
}

export interface SpeechEngine extends EngineBase {
  /** Transcribes one clip of 16 kHz mono samples; each engine encodes it as it needs. */
  transcribe(audio: Float32Array, opts: TranscribeOptions): Promise<TranscriptionResult>;
}

export interface TranslateRequest {
  text: string;
  sourceLang: Lang;
  targetLang: Lang;
  context: TranslationContextItem[];
  glossary: GlossaryEntry[];
  meetingContext?: string;
  /** Second attempt after an empty or untranslated result: answer deterministically. */
  retry?: boolean;
}

export interface TranslateEngine extends EngineBase {
  /** Streams the translation, calling onDelta for each piece. Resolves with the full text. */
  translate(
    request: TranslateRequest,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<string>;
}

export interface SummarizeRequest {
  utterances: { seq: number; sourceText: string; translation?: string }[];
  glossary: GlossaryEntry[];
  meetingContext?: string;
  outputLang: Lang;
}

export interface SummaryEngine extends EngineBase {
  /** Streams the markdown summary. Resolves with the full text. */
  summarize(
    request: SummarizeRequest,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<string>;
}

export interface Engines {
  speech: SpeechEngine;
  translate: TranslateEngine;
  summary: SummaryEngine;
}

/**
 * One way of doing the work: its name in settings and its engine for each task. A new engine
 * is one provider, added to the registry's table.
 */
export interface EngineProvider {
  readonly id: EngineId;
  /** Shown in Processing settings and the status tooltip. */
  readonly label: string;
  /** False while it is listed as "coming soon"; picking it then makes every call fail. */
  readonly built: boolean;
  speech(endpoints: EndpointSettings): SpeechEngine;
  translate(endpoints: EndpointSettings): TranslateEngine;
  summary(endpoints: EndpointSettings): SummaryEngine;
}
