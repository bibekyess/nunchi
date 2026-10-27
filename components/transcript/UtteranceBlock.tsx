'use client';

import { CircleAlert, Check, Copy, RotateCw } from 'lucide-react';
import { memo, useEffect, useRef, useState, type AnimationEvent, type MouseEvent } from 'react';
import { visibleParts } from '@/lib/display/view';
import { LANG_CODES, type Lang } from '@/lib/languages';
import { selectColumns, useDisplayStore } from '@/lib/display/store';
import { useSessionStore } from '@/lib/session/store';
import { useController } from '../session/controller-context';
import { Button, cx, IconButton } from '../ui';

/** Placeholder width grows with clip length so it hints at how much was said. */
function placeholderWidth(durationMs: number) {
  return `${Math.min(100, 25 + durationMs / 150)}%`;
}

/** Side-by-side: each language keeps its own column (static class names for Tailwind). */
const COLUMN_CLASS = ['md:col-start-1', 'md:col-start-2'];
function columnOf(lang: Lang | undefined, fallback: number) {
  const i = lang ? LANG_CODES.indexOf(lang) : -1;
  return COLUMN_CLASS[i === 0 || i === 1 ? i : fallback];
}

/** Only the element's own animation, not a caret or shimmer inside it. */
const own = (done: () => void) => (e: AnimationEvent) => {
  if (e.target === e.currentTarget) done();
};

/** Copy button with a short "Copied" confirmation. */
function CopyButton({
  text,
  className,
  hoverOnly,
}: {
  text: string;
  className?: string;
  /** Mouse-only shortcut: kept out of the tab order and the live region's announcements. */
  hoverOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => {}, // clipboard blocked; nothing useful to do
    );
  };
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={onClick}
      className={className}
      tabIndex={hoverOnly ? -1 : undefined}
      aria-hidden={hoverOnly || undefined}
    >
      {copied ? (
        <Check className="h-4 w-4 text-ok-ink" aria-hidden />
      ) : (
        <Copy className="h-4 w-4 text-ink-muted" aria-hidden />
      )}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

/**
 * `animate`: the line is new in this view, so it slides in once. Hydrated lines (hundreds on
 * a reopened session) don't. The entrance class is dropped when it ends, so showing the tab
 * again (display: none → block restarts CSS animations) doesn't replay it.
 */
export const UtteranceBlock = memo(function UtteranceBlock({
  id,
  animate = false,
}: {
  id: string;
  animate?: boolean;
}) {
  const u = useSessionStore((s) => s.byId[id]);
  const controller = useController();
  const view = useDisplayStore((s) => s.view);
  const columns = useDisplayStore(selectColumns);
  const [selected, setSelected] = useState(false);
  const block = useRef<HTMLDivElement>(null);
  // The copy row adds height: keep it clear of the dock (the scroller's scroll-padding).
  useEffect(() => {
    if (selected) block.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);
  const [entering, setEntering] = useState(animate);
  // Text fades in when the placeholder resolves while we watch (not on hydration), and again
  // when a rejoin with the next line rewrites it.
  const [prevStatus, setPrevStatus] = useState(u?.status);
  const [prevSource, setPrevSource] = useState(u?.sourceText);
  const [revealing, setRevealing] = useState(false);
  if (u && u.status !== prevStatus) {
    setPrevStatus(u.status);
    if (prevStatus === 'transcribing') setRevealing(true);
  }
  if (u && u.sourceText !== prevSource) {
    setPrevSource(u.sourceText);
    if (prevSource !== undefined) setRevealing(true);
  }

  if (!u || u.status === 'skipped') return null;

  const enter = entering && 'animate-slide-up-in';
  const onEnterEnd = own(() => setEntering(false));
  const reveal = revealing && 'animate-fade-in';
  const onRevealEnd = own(() => setRevealing(false));

  if (u.status === 'transcribing') {
    return (
      <div
        className={cx('px-3 py-3', enter)}
        onAnimationEnd={onEnterEnd}
        aria-label="Transcribing"
        data-status="transcribing"
      >
        <div
          className="shimmer h-3.5 rounded-full"
          style={{ width: placeholderWidth(u.durationMs) }}
        />
        <div
          className="shimmer mt-3 h-5 rounded-full"
          style={{ width: placeholderWidth(u.durationMs * 1.2) }}
        />
      </div>
    );
  }

  if (u.status === 'error' && !u.sourceText) {
    return (
      <div
        className={cx('flex items-center justify-between gap-3 px-3 py-2', enter, reveal)}
        onAnimationEnd={(e) => {
          onEnterEnd(e);
          onRevealEnd(e);
        }}
        data-status="error"
      >
        <p className="flex min-w-0 items-center gap-2 text-sm text-danger-ink">
          <CircleAlert className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0">Couldn&apos;t transcribe{u.error ? ` · ${u.error}` : ''}</span>
        </p>
        {controller.queue.canRetry(id) && (
          <IconButton label="Retry" variant="ghost" onClick={() => controller.queue.retry(id)}>
            <RotateCw className="h-4.5 w-4.5" aria-hidden />
          </IconButton>
        )}
      </div>
    );
  }

  const parts = visibleParts(u, view);
  if (!parts.source && !parts.translation) return null;
  // With one language picked, every visible line reads as the main text, whichever role it has.
  const single = view !== 'all';
  const sourceClass = cx(
    single ? 'translation-text text-ink' : 'source-text text-ink-muted',
    columns && 'md:row-start-1',
    columns && columnOf(u.sourceLang, 0),
  );
  const translationClass = cx(
    'translation-text text-ink',
    !single && 'mt-1',
    columns && 'md:row-start-1 md:mt-0',
    columns && columnOf(u.targetLang, 1),
  );
  const copyText = `${u.sourceText ?? ''}\n${u.translation ?? ''}`.trim();

  return (
    <div
      ref={block}
      className={cx(
        'group relative rounded-2xl px-3 py-3 transition-colors duration-200 ease-out',
        selected ? 'bg-lavender' : '[@media(hover:hover)]:hover:bg-ink/[0.03]',
        enter,
      )}
      onAnimationEnd={onEnterEnd}
      onClick={() => setSelected((v) => !v)}
      data-status={u.status}
      data-seq={u.seq}
    >
      <div
        className={cx(columns && 'md:grid md:grid-cols-2 md:gap-x-6', reveal)}
        onAnimationEnd={onRevealEnd}
      >
        {parts.source && (
          <p lang={u.sourceLang} className={sourceClass} data-role="source">
            {u.sourceText}
          </p>
        )}
        {parts.translation && (
          <p lang={u.targetLang} className={translationClass} data-role="translation">
            {u.translation}
            {u.status === 'translating' && <span className="caret" aria-hidden />}
          </p>
        )}
      </div>
      {u.status === 'error' && (
        <div className="mt-1 flex items-center gap-1 text-sm text-danger-ink">
          <CircleAlert className="h-4 w-4 shrink-0" aria-hidden />
          <span>Couldn&apos;t translate</span>
          <IconButton
            label="Retry translation"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              controller.queue.retry(id);
            }}
          >
            <RotateCw className="h-4.5 w-4.5" aria-hidden />
          </IconButton>
        </div>
      )}
      {selected ? (
        <div className="mt-2 flex animate-fade-in justify-end">
          <CopyButton text={copyText} />
        </div>
      ) : (
        // Mouse users get the same action on hover, floating so nothing reflows.
        <CopyButton
          text={copyText}
          hoverOnly
          className="absolute! right-2 bottom-2.5 hidden! opacity-0 shadow-md! transition-opacity duration-150 group-hover:opacity-100 [@media(hover:hover)]:inline-flex!"
        />
      )}
    </div>
  );
});
