'use client';

import { Check, Copy, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ApiError, summarizeStream } from '@/lib/api-client';
import { isLang, LANG_CODES, SUPPORTED_LANGS, type Lang } from '@/lib/languages';
import { sessionStore, useSessionStore } from '@/lib/store/session-store';
import { Button } from '../ui';

/** Translated lines in speech order, as the summary route expects them. */
function transcriptLines() {
  const { ids, byId } = sessionStore.getState();
  return ids
    .map((id) => byId[id])
    .filter((u) => u.status === 'done' && u.sourceText)
    .map((u) => ({ seq: u.seq, sourceText: u.sourceText!, translation: u.translation }));
}

type Phase = 'idle' | 'working' | 'error';

export function SummaryPanel() {
  const summary = useSessionStore((s) => s.session?.summary);
  const savedLang = useSessionStore((s) => s.session?.summaryLang ?? s.session?.mode.target);
  const hasLines = useSessionStore((s) => s.ids.some((id) => s.byId[id].status === 'done'));
  const setSummary = useSessionStore((s) => s.setSummary);

  const [lang, setLang] = useState<Lang>(savedLang ?? 'en');
  const [phase, setPhase] = useState<Phase>('idle');
  const [streamed, setStreamed] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const generate = async () => {
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
      if (!text.trim()) throw new ApiError(502, 'empty', 'The summary came back empty.');
      setSummary(text.trim(), lang);
      setPhase('idle');
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      if (err instanceof ApiError && err.status === 401) {
        sessionStore.getState().setNeedsAccessToken(true);
      }
      setError(err instanceof ApiError ? err.message : 'Could not summarize.');
      setPhase('error');
    }
  };

  const copy = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked; nothing useful to do
    }
  };

  const working = phase === 'working';
  const shown = working ? streamed : summary;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={generate} disabled={working || !hasLines}>
            {summary ? (
              <RefreshCw className="h-4 w-4" aria-hidden />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden />
            )}
            {summary ? 'Regenerate' : 'Generate summary'}
          </Button>
          <select
            aria-label="Summary language"
            value={lang}
            onChange={(e) => isLang(e.target.value) && setLang(e.target.value)}
            disabled={working}
            className="min-h-11 rounded-full border border-line bg-background px-4 text-sm"
          >
            {LANG_CODES.map((l) => (
              <option key={l} value={l}>
                {SUPPORTED_LANGS[l].nativeName}
              </option>
            ))}
          </select>
          <div className="flex-1" />
          {summary && !working && (
            <Button variant="ghost" onClick={copy}>
              {copied ? (
                <Check className="h-4 w-4" aria-hidden />
              ) : (
                <Copy className="h-4 w-4" aria-hidden />
              )}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          )}
        </div>

        {phase === 'error' && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {working && !streamed && (
          <p className="animate-pulse text-muted">
            Summarizing… long meetings take up to a minute.
          </p>
        )}
        {shown ? (
          <article
            data-testid="summary"
            className="prose prose-sm max-w-none md:prose-base dark:prose-invert"
            aria-busy={working}
          >
            <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }]]}>
              {shown}
            </ReactMarkdown>
          </article>
        ) : (
          !working && (
            <p className="text-muted">
              {hasLines
                ? 'Get an overview, decisions and action items from the transcript so far.'
                : 'A summary can be made once the transcript has some lines.'}
            </p>
          )
        )}
      </div>
    </div>
  );
}
