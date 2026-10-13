'use client';

import { Columns2, ZoomIn, ZoomOut } from 'lucide-react';
import { nextTextSize, TEXT_SIZE_NAMES } from '@/lib/display/view';
import { useDisplayStore } from '@/lib/store/display-store';
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
        className={cx(columns && 'bg-subtle')}
      >
        <Columns2 className="h-5 w-5" aria-hidden />
      </IconButton>
    </span>
  );
}

/** One tap steps through S → M → L → S. */
export function TextSizeButton() {
  const size = useDisplayStore((s) => s.textSize);
  const setSize = useDisplayStore((s) => s.setTextSize);
  const next = nextTextSize(size);
  const Icon = size === 'l' ? ZoomOut : ZoomIn;
  return (
    <IconButton
      label={`Text size: ${TEXT_SIZE_NAMES[size]}. Tap for ${TEXT_SIZE_NAMES[next]}.`}
      onClick={() => setSize(next)}
    >
      <Icon className="h-5 w-5" aria-hidden />
    </IconButton>
  );
}
