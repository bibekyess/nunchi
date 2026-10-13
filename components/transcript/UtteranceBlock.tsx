'use client';

import { Copy, RotateCw } from 'lucide-react';
import { memo, useState } from 'react';
import { useSessionStore } from '@/lib/store/session-store';
import { useController } from '../session/controller-context';
import { cx } from '../ui';

/** Placeholder width grows with clip length so it hints at how much was said. */
function placeholderWidth(durationMs: number) {
  return `${Math.min(100, 25 + durationMs / 150)}%`;
}

export const UtteranceBlock = memo(function UtteranceBlock({ id }: { id: string }) {
  const u = useSessionStore((s) => s.byId[id]);
  const controller = useController();
  const [selected, setSelected] = useState(false);

  if (!u || u.status === 'skipped') return null;

  if (u.status === 'transcribing') {
    return (
      <div className="px-3 py-3" aria-label="Transcribing" data-status="transcribing">
        <div className="shimmer h-3.5 rounded" style={{ width: placeholderWidth(u.durationMs) }} />
        <div
          className="shimmer mt-3 h-5 rounded"
          style={{ width: placeholderWidth(u.durationMs * 1.2) }}
        />
      </div>
    );
  }

  if (u.status === 'error' && !u.sourceText) {
    return (
      <div className="flex items-center justify-between gap-3 px-3 py-3" data-status="error">
        <p className="text-sm text-muted">
          Couldn&apos;t transcribe{u.error ? ` · ${u.error}` : ''}
        </p>
        {controller.queue.canRetry(id) && (
          <button
            type="button"
            onClick={() => controller.queue.retry(id)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full active:bg-subtle"
            aria-label="Retry"
          >
            <RotateCw className="h-5 w-5" aria-hidden />
          </button>
        )}
      </div>
    );
  }

  const copy = () => {
    void navigator.clipboard?.writeText(`${u.sourceText ?? ''}\n${u.translation ?? ''}`.trim());
  };

  return (
    <div
      className={cx('rounded-xl px-3 py-3 transition-colors', selected && 'bg-subtle')}
      onClick={() => setSelected((v) => !v)}
      data-status={u.status}
      data-seq={u.seq}
    >
      <p lang={u.sourceLang} className="source-text text-muted">
        {u.sourceText}
      </p>
      <p lang={u.targetLang} className="translation-text mt-1 text-foreground">
        {u.translation}
        {u.status === 'translating' && <span className="caret" aria-hidden />}
      </p>
      {u.status === 'error' && (
        <div className="mt-1 flex items-center gap-2 text-sm text-muted">
          <span>Couldn&apos;t translate</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              controller.queue.retry(id);
            }}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full active:bg-subtle"
            aria-label="Retry translation"
          >
            <RotateCw className="h-5 w-5" aria-hidden />
          </button>
        </div>
      )}
      {selected && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              copy();
            }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm text-muted active:bg-background"
          >
            <Copy className="h-4 w-4" aria-hidden /> Copy
          </button>
        </div>
      )}
    </div>
  );
});
