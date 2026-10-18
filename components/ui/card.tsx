'use client';

import type { HTMLAttributes } from 'react';
import { cx } from './classes';

/** Solid surface for content (transcript text, lists). */
export function Card({
  padded = true,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return (
    <div
      className={cx(
        'rounded-2xl border border-line bg-surface shadow-sm',
        padded && 'p-4',
        className,
      )}
      {...rest}
    />
  );
}
