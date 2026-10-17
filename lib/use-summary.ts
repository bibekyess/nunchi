import { useCallback, useEffect, useRef, useState } from 'react';
import { summarizeStream } from '@/lib/api-client';
import { EngineError } from '@/lib/errors';
import type { Lang } from '@/lib/languages';
import { sessionStore, useSessionStore } from '@/lib/store/session-store';

/** Translated lines in speech order, as the summary route expects them. */
function transcriptLines() {
  const { ids, byId } = sessionStore.getState();
  return ids
    .map((id) => byId[id])
    .filter((u) => u.status === 'done' && u.sourceText)
    .map((u) => ({ seq: u.seq, sourceText: u.sourceText!, translation: u.translation }));
}

export type SummaryPhase = 'idle' | 'working' | 'error';

/**
 * Generates the session summary: streams it into `streamed`, then saves it to the session.
 * A new request (or unmounting) aborts the one in flight.
 */
export function useSummary() {
  const setSummary = useSessionStore((s) => s.setSummary);
  const [phase, setPhase] = useState<SummaryPhase>('idle');
  const [streamed, setStreamed] = useState('');
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const generate = useCallback(
    async (lang: Lang) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      const session = sessionStore.getState().session;
      if (!session) return;
      setPhase('working');
      setStreamed('');
      setError('');
      try {
        let text = '';
        text = await summarizeStream(
          {
            utterances: transcriptLines(),
            glossary: session.glossary,
            meetingContext: session.meetingContext,
            outputLang: lang,
          },
          (delta) => {
            text += delta;
            setStreamed(text);
          },
          controller.signal,
        );
        if (!text.trim()) throw new EngineError('upstream', 'The summary came back empty.');
        setSummary(text.trim(), lang);
        setPhase('idle');
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        if (err instanceof EngineError && err.kind === 'auth') {
          sessionStore.getState().setNeedsAccessToken(true);
        }
        setError(err instanceof EngineError ? err.message : 'Could not summarize.');
        setPhase('error');
      }
    },
    [setSummary],
  );

  return { phase, streamed, error, generate };
}
