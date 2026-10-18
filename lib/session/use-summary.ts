import { useCallback, useEffect, useRef, useState } from 'react';
import { getEngine } from '@/lib/engines/registry';
import { EngineError } from '@/lib/errors';
import type { Lang } from '@/lib/languages';
import { sessionStore } from '@/lib/session/store';

/** Translated lines in speech order, as summary engines expect them. */
function transcriptLines() {
  const { ids, byId } = sessionStore.getState();
  return ids
    .map((id) => byId[id])
    .filter((u) => u.status === 'done' && u.sourceText)
    .map((u) => ({ seq: u.seq, sourceText: u.sourceText!, translation: u.translation }));
}

export type SummaryPhase = 'idle' | 'working' | 'error';

/**
 * Generates the session summary in `lang` with the chosen engine and saves it to the session,
 * calling `onText` with the text so far while it streams. Once `signal` aborts (a newer
 * request, or leaving), nothing more is reported or saved, even from an engine that keeps
 * going. Resolves true when saved, false when aborted; throws an `EngineError` on failure.
 */
export async function generateSummary(
  lang: Lang,
  signal: AbortSignal,
  onText: (text: string) => void,
): Promise<boolean> {
  const session = sessionStore.getState().session;
  if (!session) return false;
  const engine = getEngine('summary');
  let text = '';
  try {
    text = await engine.summarize(
      {
        utterances: transcriptLines(),
        glossary: session.glossary,
        meetingContext: session.meetingContext,
        outputLang: lang,
      },
      (delta) => {
        if (signal.aborted) return;
        text += delta;
        onText(text);
      },
      signal,
    );
  } catch (err) {
    if (signal.aborted || (err as Error)?.name === 'AbortError') return false;
    if (err instanceof EngineError && err.needsPasscode) {
      sessionStore.getState().setNeedsAccessToken(true);
    }
    throw err;
  }
  if (signal.aborted) return false;
  if (!text.trim()) {
    throw new EngineError('upstream', 'The summary came back empty.', { engine: engine.id });
  }
  sessionStore.getState().setSummary(text.trim(), lang);
  return true;
}

/**
 * The summary panel's state: streams the summary into `streamed`, then saves it to the
 * session. A new request (or unmounting) aborts the one in flight.
 */
export function useSummary() {
  const [phase, setPhase] = useState<SummaryPhase>('idle');
  const [streamed, setStreamed] = useState('');
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const generate = useCallback(async (lang: Lang) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    if (!sessionStore.getState().session) return;
    setPhase('working');
    setStreamed('');
    setError('');
    try {
      if (await generateSummary(lang, controller.signal, setStreamed)) setPhase('idle');
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof EngineError ? err.message : 'Could not summarize.');
      setPhase('error');
    }
  }, []);

  return { phase, streamed, error, generate };
}
