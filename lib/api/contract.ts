// The HTTP contract between the browser (`lib/engines/server.ts`) and the app's own /api/*
// routes: paths, request bodies and responses, in one place so neither side can drift.
// Client- and server-safe. The engine interfaces stay transport-free; each request schema is
// checked against its interface with `satisfies`.
import { z } from 'zod';
import type { SummarizeRequest, TranscribeOptions, TranslateRequest } from '@/lib/engines/types';
import {
  glossarySchema,
  langOrAutoSchema,
  langSchema,
  meetingContextSchema,
  translationContextSchema,
} from '@/lib/api/schemas';
import type { TranscriptionResult } from '@/lib/types';

export const API_PATHS = {
  health: '/api/health',
  transcribe: '/api/transcribe',
  translate: '/api/translate',
  summarize: '/api/summarize',
} as const;

// ---- Requests ----

/** Form fields sent with the clip (`audio`, a 16 kHz mono WAV) to /api/transcribe. */
export const transcribeFieldsSchema = z.object({
  language: langOrAutoSchema.default('auto'),
  prompt: z.string().max(200).optional(),
}) satisfies z.ZodType<Omit<TranscribeOptions, 'signal'>>;

export const translateBodySchema = z.object({
  text: z.string().trim().min(1).max(2000),
  sourceLang: langSchema,
  targetLang: langSchema,
  context: translationContextSchema,
  glossary: glossarySchema,
  meetingContext: meetingContextSchema,
  /** Second attempt after an empty or untranslated result: answer deterministically. */
  retry: z.boolean().optional(),
}) satisfies z.ZodType<TranslateRequest>;

export const summarizeBodySchema = z.object({
  utterances: z
    .array(
      z.object({
        seq: z.number().int().nonnegative(),
        sourceText: z.string().max(2000),
        translation: z.string().max(4000).optional(),
      }),
    )
    .min(1)
    .max(5000),
  glossary: glossarySchema,
  meetingContext: meetingContextSchema,
  outputLang: langSchema,
}) satisfies z.ZodType<SummarizeRequest>;

// ---- Responses ----

export const transcriptionResultSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  durationMs: z.number(),
  segments: z.array(
    z.object({ text: z.string(), noSpeechProb: z.number(), avgLogprob: z.number() }),
  ),
}) satisfies z.ZodType<TranscriptionResult>;

const serviceHealthSchema = z.enum(['ok', 'error', 'not_configured']);

export const healthStatusSchema = z.object({
  speaches: serviceHealthSchema,
  llm: serviceHealthSchema,
});

export type ServiceHealth = z.infer<typeof serviceHealthSchema>;
export type HealthStatus = z.infer<typeof healthStatusSchema>;

/** Every error response, whatever the route: `{ error: { code, message } }`. */
export const apiErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
