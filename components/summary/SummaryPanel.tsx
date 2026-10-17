'use client';

import {
  Check,
  ChevronDown,
  Copy,
  Loader2,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isLang, LANG_CODES, SUPPORTED_LANGS, type Lang } from '@/lib/languages';
import { useSessionStore } from '@/lib/store/session-store';
import { useSummary } from '@/lib/use-summary';
import { LangFlag } from '../LangFlag';
import { Button, Card, cx, SELECT_PILL } from '../ui';

export function SummaryPanel() {
  const summary = useSessionStore((s) => s.session?.summary);
  const savedLang = useSessionStore((s) => s.session?.summaryLang ?? s.session?.mode.target);
  const hasLines = useSessionStore((s) => s.ids.some((id) => s.byId[id].status === 'done'));
  const { phase, streamed, error, generate } = useSummary();

  const [lang, setLang] = useState<Lang>(savedLang ?? 'en');
  const [copied, setCopied] = useState(false);

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
    // Scrolls under the floating chrome like the transcript, padded by its height.
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-[calc(var(--top-inset)+1rem)] pb-[calc(var(--bottom-inset)+1rem)] scroll-pt-[var(--top-inset)]">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            onClick={() => void generate(lang)}
            disabled={working || !hasLines}
          >
            {working ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : summary ? (
              <RefreshCw className="h-4 w-4" aria-hidden />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden />
            )}
            {summary ? 'Regenerate' : 'Generate summary'}
          </Button>
          <label
            className={cx(SELECT_PILL, 'shrink-0', working && 'pointer-events-none opacity-40')}
          >
            <LangFlag lang={lang} />
            <span aria-hidden>{SUPPORTED_LANGS[lang].nativeName}</span>
            <ChevronDown className="-ml-0.5 h-4 w-4 text-ink-muted" aria-hidden />
            <select
              aria-label="Summary language"
              value={lang}
              onChange={(e) => isLang(e.target.value) && setLang(e.target.value)}
              disabled={working}
            >
              {LANG_CODES.map((l) => (
                <option key={l} value={l}>
                  {SUPPORTED_LANGS[l].nativeName}
                </option>
              ))}
            </select>
          </label>
          <div className="flex-1" />
          {summary && !working && (
            // Icon only on phones (the label stays as the accessible name).
            <Button variant="ghost" onClick={copy} className="max-sm:w-11 max-sm:px-0">
              {copied ? (
                <Check className="h-4 w-4 text-ok-ink" aria-hidden />
              ) : (
                <Copy className="h-4 w-4" aria-hidden />
              )}
              <span className="max-sm:sr-only">{copied ? 'Copied' : 'Copy'}</span>
            </Button>
          )}
        </div>

        {phase === 'error' && (
          <div
            role="alert"
            className="flex animate-slide-down-in items-start gap-3 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger-ink"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>{error}</p>
          </div>
        )}
        {working && !streamed && (
          <Card className="animate-fade-in p-5 md:p-6">
            <p className="flex items-center gap-2 text-sm text-ink-muted">
              <Sparkles className="h-4 w-4 animate-pulse-dot text-accent" aria-hidden />
              Summarizing… long meetings take up to a minute.
            </p>
            <div aria-hidden className="mt-5 flex flex-col gap-2.5">
              <span className="shimmer h-5 w-2/5 rounded-md" />
              <span className="shimmer h-3.5 w-full rounded-md" />
              <span className="shimmer h-3.5 w-11/12 rounded-md" />
              <span className="shimmer h-3.5 w-3/5 rounded-md" />
              <span className="shimmer mt-3 h-5 w-1/3 rounded-md" />
              <span className="shimmer h-3.5 w-10/12 rounded-md" />
              <span className="shimmer h-3.5 w-2/3 rounded-md" />
            </div>
          </Card>
        )}
        {shown ? (
          <Card className="animate-fade-in p-5 md:p-7">
            <article
              data-testid="summary"
              className="summary-prose prose prose-sm max-w-none md:prose-base"
              aria-busy={working}
            >
              <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }]]}>
                {shown}
              </ReactMarkdown>
            </article>
          </Card>
        ) : (
          !working && (
            <Card className="flex animate-fade-in flex-col items-center px-6 py-12 text-center">
              <span
                aria-hidden
                className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-lavender text-accent-ink"
              >
                <Sparkles className="h-7 w-7" strokeWidth={1.75} />
              </span>
              <p className="max-w-xs text-ink-muted">
                {hasLines
                  ? 'Get an overview, decisions and action items from the transcript so far.'
                  : 'A summary can be made once the transcript has some lines.'}
              </p>
            </Card>
          )
        )}
      </div>
    </div>
  );
}
