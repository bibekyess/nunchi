'use client';

import { useEffect, useRef, useState } from 'react';
import { revealFrom } from '@/lib/display/draft-reveal';

/** The newest words type out over at most this long, then wait for the next draft. */
const TYPE_MS = 600;
/** …and never slower than this many characters a second. */
const MIN_CPS = 30;

function reducedMotion() {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Reveals `text` a few characters at a time, picking up from what it already shows, so each
 * new draft reads like it is being typed rather than swapped in. Words already on screen are
 * never typed again: when a draft rewrites them ("I am" → "I'm") they change in place, and only
 * the words after them type out (see `revealFrom`).
 */
export function useTypewriter(text: string, startFull = false): string {
  const [shown, setShown] = useState(() => (startFull || reducedMotion() ? text : ''));
  const shownRef = useRef(shown);
  /** The draft being typed; `shown` differs from it only while typing. */
  const targetRef = useRef(shown);

  useEffect(() => {
    const typing = shownRef.current !== targetRef.current;
    targetRef.current = text;
    if (reducedMotion()) {
      const id = requestAnimationFrame(() => {
        shownRef.current = text;
        setShown(text);
      });
      return () => cancelAnimationFrame(id);
    }
    const from = revealFrom(shownRef.current, typing, text);
    const remaining = text.length - from;
    const cps = Math.max(MIN_CPS, (remaining * 1000) / TYPE_MS);
    let start: number | null = null;
    let raf = 0;
    const step = (t: number) => {
      start ??= t;
      const n = Math.min(text.length, from + Math.floor(((t - start) / 1000) * cps));
      const next = text.slice(0, n);
      if (next !== shownRef.current) {
        shownRef.current = next;
        setShown(next);
      }
      if (n < text.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text]);

  return shown;
}

/**
 * Speech-to-text that isn't final yet: faint, typed out, with a caret. Hidden from screen
 * readers, which get the finished line instead of every draft.
 */
export function DraftText({
  text,
  className,
  startFull,
}: {
  text: string;
  className?: string;
  /** Show the text at once (a row taking over from the live line), typing only what's new. */
  startFull?: boolean;
}) {
  const shown = useTypewriter(text, startFull);
  return (
    <p className={className} aria-hidden data-role="draft">
      <span className="text-ink-faint">{shown}</span>
      <span className="caret" />
    </p>
  );
}
