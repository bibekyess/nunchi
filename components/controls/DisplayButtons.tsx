'use client';

import { Columns2 } from 'lucide-react';
import { nextTextSize, TEXT_SIZE_NAMES, TEXT_SIZES } from '@/lib/display/view';
import { useDisplayStore } from '@/lib/display/store';
import { cx, IconButton } from '../ui';

/** Side-by-side columns (one per language). Only offered on wide screens. */
export function LayoutToggle() {
  const layout = useDisplayStore((s) => s.layout);
  const view = useDisplayStore((s) => s.view);
  const setLayout = useDisplayStore((s) => s.setLayout);
  const columns = layout === 'columns';
  // The wrapper hides it on phones; IconButton's own display class would override `hidden`.
  return (
    <span className="hidden md:inline-flex">
      <IconButton
        label={view === 'all' ? 'Side by side' : 'Side by side (needs All languages)'}
        aria-pressed={columns}
        disabled={view !== 'all'}
        onClick={() => setLayout(columns ? 'stacked' : 'columns')}
      >
        <Columns2 className="h-5 w-5" aria-hidden />
      </IconButton>
    </span>
  );
}

const GLYPH_SIZE = { s: 'text-[0.8125rem]', m: 'text-[0.9375rem]', l: 'text-[1.0625rem]' };

/** One tap steps through S → M → L → S. "Aa" grows with the size; dots show the step. */
export function TextSizeButton() {
  const size = useDisplayStore((s) => s.textSize);
  const setSize = useDisplayStore((s) => s.setTextSize);
  const next = nextTextSize(size);
  return (
    <IconButton
      label={`Text size: ${TEXT_SIZE_NAMES[size]}. Tap for ${TEXT_SIZE_NAMES[next]}.`}
      onClick={() => setSize(next)}
      className="flex-col gap-0.5"
    >
      <span
        aria-hidden
        className={cx(
          'h-5 leading-5 font-semibold tracking-tight transition-[font-size] duration-150',
          GLYPH_SIZE[size],
        )}
      >
        Aa
      </span>
      <span aria-hidden className="flex gap-0.5">
        {TEXT_SIZES.map((s) => (
          <span
            key={s}
            className={cx(
              'h-1 w-1 rounded-full transition-colors duration-150',
              s === size ? 'bg-ink' : 'bg-ink/20',
            )}
          />
        ))}
      </span>
    </IconButton>
  );
}
