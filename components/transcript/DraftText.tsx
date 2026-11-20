'use client';

import { useEffect, useRef, useState } from 'react';

/** The newest words type out over at most this long, then wait for the next draft. */
const TYPE_MS = 600;
/** …and never slower than this many characters a second. */
const MIN_CPS = 30;

function commonPrefix(a: string, b: string) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function reducedMotion() {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Reveals `text` a few characters at a time, picking up from what it already shows, so each
 * new draft reads like it is being typed rather than swapped in. A draft can also rewrite
 * earlier words; those change at once and the typing resumes from there.
 */
export function useTypewriter(text: string, startFull = false): string {
  const [shown, setShown] = useState(() => (startFull || reducedMotion() ? text : ''));
  const shownRef = useRef(shown);

  useEffect(() => {
    if (reducedMotion()) {
      const id = requestAnimationFrame(() => {
        shownRef.current = text;
        setShown(text);
      });
      return () => cancelAnimationFrame(id);
    }
    const from = commonPrefix(shownRef.current, text);
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
