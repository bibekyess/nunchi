import type { Lang } from '@/lib/languages';
import { cx } from './ui';

// Inline SVG flags: emoji flags don't render on Windows. Simplified to read at 20 px.

function FlagKR() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <rect width="20" height="20" fill="#fff" />
      <path d="M6.5 10a3.5 3.5 0 0 1 7 0z" fill="#cd2e3a" />
      <path d="M6.5 10a3.5 3.5 0 0 0 7 0z" fill="#0047a0" />
      <circle cx="8.25" cy="10" r="1.75" fill="#cd2e3a" />
      <circle cx="11.75" cy="10" r="1.75" fill="#0047a0" />
      <g stroke="#000" strokeWidth="0.9">
        <path d="M3.2 5.6l1.6-1.6M4 6.4l1.6-1.6M14.4 4.8l1.6 1.6M15.2 4l1.6 1.6" />
        <path d="M3.2 14.4l1.6 1.6M4 13.6l1.6 1.6M14.4 15.2l1.6-1.6M15.2 16l1.6-1.6" />
      </g>
    </svg>
  );
}

function FlagUS() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <rect width="20" height="20" fill="#fff" />
      {[0, 2, 4, 6, 8, 10, 12].map((i) => (
        <rect key={i} y={(i * 20) / 13} width="20" height={20 / 13} fill="#b22234" />
      ))}
      <rect width="10" height={(20 / 13) * 7} fill="#3c3b6e" />
      <g fill="#fff">
        <circle cx="2.5" cy="2.5" r="0.7" />
        <circle cx="5" cy="2.5" r="0.7" />
        <circle cx="7.5" cy="2.5" r="0.7" />
        <circle cx="3.75" cy="5" r="0.7" />
        <circle cx="6.25" cy="5" r="0.7" />
        <circle cx="2.5" cy="7.5" r="0.7" />
        <circle cx="5" cy="7.5" r="0.7" />
        <circle cx="7.5" cy="7.5" r="0.7" />
      </g>
    </svg>
  );
}

const FLAGS: Partial<Record<Lang, () => React.ReactElement>> = { ko: FlagKR, en: FlagUS };

/** A round flag for a language; languages without a flag show their code. */
export function LangFlag({ lang, className }: { lang: Lang; className?: string }) {
  const Flag = FLAGS[lang];
  return (
    <span
      className={cx(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-subtle text-[9px] font-semibold uppercase ring-1 ring-line [&>svg]:h-full [&>svg]:w-full',
        className,
      )}
    >
      {Flag ? <Flag /> : lang}
    </span>
  );
}
