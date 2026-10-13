'use client';

import { ArrowDown } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LANG_CODES, SUPPORTED_LANGS } from '@/lib/languages';
import { selectColumns, useDisplayStore } from '@/lib/store/display-store';
import { useSessionStore } from '@/lib/store/session-store';
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

  // Keep following when the viewport resizes (mobile keyboard, rotation).
  useEffect(() => {
    const onResize = () => followingRef.current && scrollToBottom();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [scrollToBottom]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="h-full overflow-y-auto overscroll-contain px-1 pb-6"
        aria-live="polite"
        aria-relevant="additions"
        data-size={textSize}
        data-layout={columns ? 'columns' : 'stacked'}
      >
        {visibleCount === 0 ? (
          <EmptyState recording={recorder === 'listening'} />
        ) : (
          <div
            className={cx('mx-auto flex max-w-3xl flex-col gap-1 pt-2', columns && 'md:max-w-5xl')}
          >
            {columns && <ColumnHeaders />}
            {ids.map((id) => (
              <UtteranceBlock key={id} id={id} />
            ))}
          </div>
        )}
      </div>
      {!following && (
        <button
          type="button"
          onClick={() => {
            followingRef.current = true;
            setFollowing(true);
            scrollToBottom(true);
          }}
          className="absolute bottom-4 left-1/2 inline-flex h-12 w-12 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-background shadow-md"
          aria-label="Jump to latest"
        >
          <ArrowDown className="h-5 w-5" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Column titles for the side-by-side layout (wide screens only). */
function ColumnHeaders() {
  return (
    <div className="sticky top-0 z-[1] hidden grid-cols-2 gap-6 bg-background px-3 py-2 text-sm font-medium text-muted md:grid">
      {LANG_CODES.slice(0, 2).map((l) => (
        <span key={l} className="flex items-center gap-2">
          <LangFlag lang={l} />
          {SUPPORTED_LANGS[l].nativeName}
        </span>
      ))}
    </div>
  );
}

function EmptyState({ recording }: { recording: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted">
      {recording ? (
        <>
          <p className="text-lg">Listening…</p>
          <p className="text-sm">Each sentence appears here a moment after the speaker pauses.</p>
        </>
      ) : (
        <>
          <p className="text-lg">Tap the microphone to start</p>
          <p className="text-sm">
            Place the phone where it can hear the room. Korean is translated to English and English
            to Korean.
          </p>
        </>
      )}
    </div>
  );
}
