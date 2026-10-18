'use client';

import { ArrowDown, Mic } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LANG_CODES, SUPPORTED_LANGS } from '@/lib/languages';
import { selectColumns, useDisplayStore } from '@/lib/display/store';
import { useSessionStore } from '@/lib/session/store';
import { LangFlag } from '../LangFlag';
import { cx } from '../ui';
import { UtteranceBlock } from './UtteranceBlock';

/** Within this many px of the bottom counts as "at the bottom". */
const STICK_THRESHOLD = 80;

export function TranscriptList() {
  const ids = useSessionStore((s) => s.ids);
  const visibleCount = useSessionStore(
    (s) => s.ids.filter((id) => s.byId[id].status !== 'skipped').length,
  );
  // Any text change (streaming translation) should keep us pinned to the bottom.
  const lastText = useSessionStore((s) => {
    const last = s.ids.at(-1);
    return last ? `${s.byId[last].status}:${s.byId[last].translation?.length ?? 0}` : '';
  });
  const recorder = useSessionStore((s) => s.recorder);
  const textSize = useDisplayStore((s) => s.textSize);
  const columns = useDisplayStore(selectColumns);

  // Lines already there on mount (a reopened session) appear at once; only new ones animate.
  const [initialIds] = useState(() => new Set(ids));

  const scroller = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
    followingRef.current = atBottom;
    setFollowing(atBottom);
  };

  useLayoutEffect(() => {
    if (followingRef.current) scrollToBottom();
  }, [ids.length, lastText, textSize, columns, scrollToBottom]);

  // Keep following when the scroller's content box resizes: the viewport (mobile keyboard,
  // rotation) or --top-inset growing as a banner appears (more padding, smaller content box).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => followingRef.current && scrollToBottom());
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  return (
    <div className="relative min-h-0 flex-1">
      {/* Padded by the floating chrome's height, so lines scroll under the glass. */}
      <div
        ref={scroller}
        onScroll={onScroll}
        className="h-full overflow-y-auto overscroll-contain px-2 scroll-pt-[var(--top-inset)] scroll-pb-[var(--bottom-inset)] pt-[var(--top-inset)] pb-[var(--bottom-inset)] md:px-3"
        aria-live="polite"
        aria-relevant="additions"
        data-size={textSize}
        data-layout={columns ? 'columns' : 'stacked'}
      >
        {visibleCount === 0 ? (
          <EmptyState recording={recorder === 'listening'} />
        ) : (
          <div
            className={cx(
              'mx-auto flex max-w-3xl flex-col gap-0.5 pt-2',
              columns && 'md:max-w-5xl',
            )}
          >
            {columns && <ColumnHeaders />}
            {ids.map((id) => (
              <UtteranceBlock key={id} id={id} animate={!initialIds.has(id)} />
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          followingRef.current = true;
          setFollowing(true);
          scrollToBottom(true);
        }}
        className={cx(
          'glass absolute bottom-[calc(var(--bottom-inset)-0.25rem)] left-1/2 z-10 inline-flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-full pr-4 pl-3 text-sm font-medium text-ink transition-[opacity,transform,visibility,background-color] duration-200 ease-out hover:bg-glass-strong active:scale-95',
          // Hidden with visibility (after the fade), which also drops it from focus and a11y.
          following ? 'invisible translate-y-2 opacity-0' : 'visible translate-y-0 opacity-100',
        )}
        aria-label="Jump to latest"
      >
        <ArrowDown className="h-4 w-4" aria-hidden />
        Latest
      </button>
    </div>
  );
}

/**
 * Column titles for the side-by-side layout (wide screens only). Sticky offsets count from
 * the scroller's padding edge, which already clears the top bar (--top-inset).
 */
function ColumnHeaders() {
  return (
    <div className="sticky top-0 z-[1] mb-1 hidden grid-cols-2 gap-6 rounded-2xl border border-line bg-surface px-3 py-2 text-sm font-medium text-ink-muted shadow-sm md:grid">
      {LANG_CODES.slice(0, 2).map((l) => (
        <span key={l} className="flex items-center gap-2">
          <LangFlag lang={l} />
          {SUPPORTED_LANGS[l].nativeName}
        </span>
      ))}
    </div>
  );
}

/** Bar heights for the listening waveform (they also read well when motion is reduced). */
const WAVE = [0.45, 0.8, 1, 0.65, 0.9, 0.5, 0.7];

function EmptyState({ recording }: { recording: boolean }) {
  return (
    <div className="flex h-full animate-fade-in flex-col items-center justify-center px-6 text-center">
      {recording ? (
        <>
          <div aria-hidden className="mb-6 flex h-20 items-center gap-1.5">
            {WAVE.map((h, i) => (
              <span
                key={i}
                className="w-1.5 animate-wave rounded-full bg-accent/70"
                style={{ height: `${h * 3.5}rem`, animationDelay: `${i * -0.17}s` }}
              />
            ))}
          </div>
          <p className="text-lg font-semibold tracking-tight text-ink">Listening…</p>
          <p className="mt-1.5 max-w-xs text-sm text-ink-muted">
            Each sentence appears here a moment after the speaker pauses.
          </p>
        </>
      ) : (
        <>
          <div aria-hidden className="relative mb-6 flex h-24 w-24 items-center justify-center">
            <span className="absolute inset-0 animate-breathe rounded-full bg-lavender" />
            <span className="absolute inset-3 rounded-full bg-lavender-strong" />
            <Mic className="relative h-8 w-8 text-accent-ink" strokeWidth={1.75} />
          </div>
          <p className="text-lg font-semibold tracking-tight text-ink">
            Tap the microphone to start
          </p>
          <p className="mt-1.5 max-w-xs text-sm text-ink-muted">
            Place the phone where it can hear the room. Korean is translated to English and English
            to Korean.
          </p>
        </>
      )}
    </div>
  );
}
