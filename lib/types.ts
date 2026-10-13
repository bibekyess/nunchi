import type { Lang } from './languages';

export type { Lang };

export type UtteranceStatus =
  | 'transcribing' // audio sent to /api/transcribe
  | 'translating' // text known, translation streaming
  | 'done'
  | 'skipped' // empty or hallucination-filtered; hidden
  | 'error'; // retry available

export interface Utterance {
  id: string; // uuid, stable for the life of the session (Phase 5 share relies on it)
  sessionId: string;
  seq: number; // order of speech, 0-based
  startedAt: number; // ms since session start
  durationMs: number;
  sourceLang?: Lang; // detected by Whisper
  sourceText?: string;
  targetLang?: Lang;
  translation?: string; // grows while streaming
  status: UtteranceStatus;
  error?: string;
  speaker?: string; // Phase 4
}

export interface TranslationMode {
  source: Lang | 'auto';
  target: Lang;
}

export interface Session {
  id: string;
  title: string; // default: "YYYYMMDD Meeting"
  createdAt: number;
  endedAt?: number;
  /** Time spent listening, excluding pauses. */
  durationMs?: number;
  mode: TranslationMode;
  glossary: GlossaryEntry[];
  meetingContext?: string;
  summary?: string; // markdown
  summaryLang?: Lang; // language the summary is written in
}

export interface GlossaryEntry {
  term: string; // as spoken, e.g. "키로"
  translation?: string; // e.g. "Kiro"
}

export interface TranslationContextItem {
  source: string;
  translation: string;
}

export interface TranscriptionSegment {
  text: string;
  noSpeechProb: number;
  avgLogprob: number;
}

export interface TranscriptionResult {
  text: string;
  /** ISO code when supported, otherwise whatever Whisper reported. */
  language: string | undefined;
  durationMs: number;
  segments: TranscriptionSegment[];
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
