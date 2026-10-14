'use client';

import { Loader2, Mic, Pause, Square } from 'lucide-react';
import { useSessionStore } from '@/lib/store/session-store';
import { useController } from '../session/controller-context';
import { cx, IconButton } from '../ui';

// The mic level changes many times a second: only these two small components subscribe to it.

function MicLevelRing() {
  const level = useSessionStore((s) => s.micLevel);
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 animate-fade-in rounded-full bg-danger/25 transition-transform duration-100 ease-out"
      style={{ transform: `scale(${1 + level * 0.4})` }}
    />
  );
}

/** Each bar reacts a little differently, so the meter looks alive rather than a single block. */
const BAR_GAIN = [0.55, 1, 0.8, 0.45];

function LevelMeter({ speaking }: { speaking: boolean }) {
  const level = useSessionStore((s) => s.micLevel);
  return (
    <span aria-hidden className="flex h-4 w-5 shrink-0 items-center gap-[3px]">
      {BAR_GAIN.map((g, i) => (
        <span
          key={i}
          className={cx(
            'h-full w-[3px] origin-center rounded-full transition-[transform,background-color] duration-100 ease-out',
            speaking ? 'bg-danger' : 'bg-ink-faint',
          )}
          style={{ transform: `scaleY(${Math.min(1, 0.22 + level * g * 1.4)})` }}
        />
      ))}
    </span>
  );
}

const ICON = 'absolute h-7 w-7 transition-[opacity,transform] duration-200 ease-out';
const shown = (on: boolean) => (on ? 'opacity-100 scale-100' : 'opacity-0 scale-50');

export function RecordBar() {
  const controller = useController();
  const recorder = useSessionStore((s) => s.recorder);
  const speaking = useSessionStore((s) => s.speaking);
  const hasUtterances = useSessionStore((s) => s.ids.length > 0);

  const listening = recorder === 'listening';
  const status =
    recorder === 'starting'
      ? 'Starting microphone…'
      : listening
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
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="glass-dock pointer-events-auto mx-auto grid h-20 max-w-md grid-cols-[1fr_auto_1fr] items-center gap-1.5 rounded-full px-2 pl-3">
        {/* Tight gaps so "Hearing speech…" fits on one line at 390 px. */}
        <div className="flex min-w-0 items-center gap-1.5">
          {listening ? (
            <LevelMeter speaking={speaking} />
          ) : (
            <span aria-hidden className="flex h-4 w-5 shrink-0 items-center justify-center">
              <span
                className={cx(
                  'h-2 w-2 rounded-full',
                  recorder === 'paused' && 'bg-warn',
                  recorder === 'starting' && 'animate-pulse-dot bg-accent',
                  (recorder === 'idle' || recorder === 'error') && 'bg-ink-faint/60',
                )}
              />
            </span>
          )}
          <p
            className={cx(
              'min-w-0 truncate text-[0.8125rem] leading-tight font-medium tracking-[-0.01em] transition-colors duration-200',
              listening && speaking ? 'text-danger-ink' : 'text-ink-muted',
            )}
            role="status"
            aria-live="polite"
          >
            {status}
          </p>
        </div>

        <button
          type="button"
          onClick={onMain}
          disabled={recorder === 'starting'}
          aria-label={mainLabel}
          className={cx(
            'relative isolate inline-flex h-16 w-16 items-center justify-center rounded-full transition-[background-color,color,box-shadow,transform] duration-200 ease-out enabled:active:scale-95',
            listening
              ? 'bg-danger text-danger-foreground shadow-[0_6px_24px_-4px_rgb(224_58_58/0.55)] enabled:hover:bg-danger-hover'
              : 'bg-ink text-surface shadow-md enabled:hover:bg-ink/88',
          )}
        >
          {listening && <MicLevelRing />}
          {/* All three icons stay mounted and crossfade on state changes. */}
          <span className={cx(ICON, shown(recorder === 'starting'))} aria-hidden>
            <Loader2 className={cx('h-7 w-7', recorder === 'starting' && 'animate-spin')} />
          </span>
          <Pause className={cx(ICON, shown(listening))} aria-hidden fill="currentColor" />
          <Mic className={cx(ICON, shown(!listening && recorder !== 'starting'))} aria-hidden />
        </button>

        <div className="flex justify-end">
          <IconButton
            label="Stop"
            size="lg"
            onClick={() => void controller.stop()}
            disabled={recorder !== 'listening' && recorder !== 'paused'}
          >
            <Square className="h-4.5 w-4.5" aria-hidden fill="currentColor" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
