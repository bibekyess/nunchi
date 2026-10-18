// Validation shared by the API routes and (later) client-side settings. Client-safe.
import { z } from 'zod';
import { LANG_CODES } from '@/lib/languages';

export const langSchema = z.enum(LANG_CODES);

export const langOrAutoSchema = z.enum([...LANG_CODES, 'auto']);

export const glossarySchema = z
  .array(z.object({ term: z.string().max(100), translation: z.string().max(200).optional() }))
  .max(200)
  .default([]);

export const meetingContextSchema = z.string().max(1000).optional();

/** Most recent finished lines sent with a translation, oldest first. */
export const translationContextSchema = z
  .array(z.object({ source: z.string().max(2000), translation: z.string().max(4000) }))
  .max(5)
  .default([]);
