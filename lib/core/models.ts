// The two model shapes the shared pipeline logic needs. Implementations live next to their
// transport: `lib/server/*` for the server, and (later) browser engines for endpoints and
// on-device models. Nothing here may depend on Node-only or DOM-only APIs.
import type { Lang } from '@/lib/languages';
import type { TranscriptionResult } from '@/lib/types';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface ChatOptions {
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
  /** Overrides the model's default request timeout. */
  timeoutMs?: number;
}

/** Raw content deltas of a streamed completion (reasoning blocks not yet removed). */
export interface ChatStream extends AsyncIterable<string> {
  /** Stops the upstream request. */
  abort(): void;
}

export interface ChatModel {
  /** Opens a streamed completion. Resolves once the stream is open, so connection errors reject here. */
  stream(messages: ChatMessage[], opts: ChatOptions): Promise<ChatStream>;
  /** Non-streamed completion; resolves with the raw content. */
  complete(messages: ChatMessage[], opts: ChatOptions): Promise<string>;
}

export interface SpeechOptions {
  language?: Lang; // omit for auto-detect
  prompt?: string;
  signal?: AbortSignal;
}

export interface SpeechModel {
  /** Transcribes one 16 kHz mono WAV clip. */
  transcribe(wav: Blob, opts?: SpeechOptions): Promise<TranscriptionResult>;
}
