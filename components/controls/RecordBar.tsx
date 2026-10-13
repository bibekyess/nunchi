'use client';

import { Loader2, Mic, Pause, Square } from 'lucide-react';
import { useSessionStore } from '@/lib/store/session-store';
import { useController } from '../session/controller-context';
import { cx } from '../ui';

function MicLevelRing() {
  const level = useSessionStore((s) => s.micLevel);
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-red-500/30 transition-transform duration-75"
      style={{ transform: `scale(${1 + level * 0.45})` }}
    />
  );
}

export function RecordBar() {
  const controller = useController();
  const recorder = useSessionStore((s) => s.recorder);
  const speaking = useSessionStore((s) => s.speaking);
  const hasUtterances = useSessionStore((s) => s.ids.length > 0);

  const status =
    recorder === 'starting'
      ? 'Starting microphone…'
      : recorder === 'listening'
        ? speaking
          ? 'Hearing speech…'
          : 'Listening'
        : recorder === 'paused'
          ? 'Paused'
          : hasUtterances
            ? 'Stopped'
            : 'Ready';

  const onMain = () => {
    if (recorder === 'listening') void controller.pause();
    else if (recorder === 'paused') void controller.resume();
    else if (recorder === 'idle' || recorder === 'error') void controller.start();
  };

  const mainLabel =
    recorder === 'listening'
      ? 'Pause'
      : recorder === 'paused'
        ? 'Resume listening'
        : 'Start listening';

  return (
    <div className="border-t border-line bg-background pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3">
        <p className="w-28 text-sm text-muted" role="status" aria-live="polite">
          {status}
        </p>

        <button
          type="button"
          onClick={onMain}
          disabled={recorder === 'starting'}
          aria-label={mainLabel}
          className={cx(
            'relative isolate inline-flex h-16 w-16 items-center justify-center rounded-full transition-colors',
            recorder === 'listening' ? 'bg-red-600 text-white' : 'bg-foreground text-background',
          )}
        >
          {recorder === 'listening' && <MicLevelRing />}
          {recorder === 'starting' ? (
            <Loader2 className="relative h-7 w-7 animate-spin" aria-hidden />
          ) : recorder === 'listening' ? (
            <Pause className="relative h-7 w-7" aria-hidden fill="currentColor" />
          ) : (
            <Mic className="relative h-7 w-7" aria-hidden />
          )}
        </button>

        <div className="flex w-28 justify-end">
          <button
            type="button"
            onClick={() => void controller.stop()}
            disabled={recorder !== 'listening' && recorder !== 'paused'}
            aria-label="Stop"
            className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-line disabled:opacity-30"
          >
            <Square className="h-5 w-5" aria-hidden fill="currentColor" />
          </button>
        </div>
      </div>
    </div>
  );
}
