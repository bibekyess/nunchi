'use client';

import { TriangleAlert, KeyRound, MonitorX, RotateCw, WifiOff, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { needsNetwork } from '@/lib/engines/registry';
import { setAccessToken } from '@/lib/engines/server';
import { useEngineSettings } from '@/lib/settings/engines';
import { useSessionStore } from '@/lib/store/session-store';
import { Button, cx, IconButton, Input } from '../ui';
import { useController } from './controller-context';

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

type BannerTone = 'neutral' | 'accent' | 'warn' | 'danger';

// Tints are layered over a solid surface: the soft tones are translucent in dark mode, and
// transcript text scrolling under the glass bar must not show through.
const TONES: Record<BannerTone, string> = {
  neutral: 'border-line text-ink [--tint:transparent]',
  accent: 'border-transparent text-accent-ink [--tint:var(--lavender)]',
  warn: 'border-transparent text-warn-ink [--tint:var(--warn-soft)]',
  danger: 'border-transparent text-danger-ink [--tint:var(--danger-soft)]',
};

/** A tinted notice under the toolbar (inside the glass top bar, so no blur of its own). */
function Banner({
  tone,
  icon,
  children,
  onDismiss,
}: {
  tone: BannerTone;
  icon: ReactNode;
  children: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      className={cx(
        'mb-2 flex animate-slide-down-in items-center gap-3 rounded-2xl border bg-surface bg-[image:linear-gradient(var(--tint),var(--tint))] py-1.5 pl-4 text-sm shadow-sm',
        onDismiss ? 'pr-1' : 'pr-2',
        TONES[tone],
      )}
      role="alert"
    >
      <span className="flex shrink-0 [&>svg]:h-4 [&>svg]:w-4" aria-hidden>
        {icon}
      </span>
      <div className="flex min-h-11 flex-1 flex-wrap items-center gap-x-3 gap-y-1">{children}</div>
      {onDismiss && (
        <IconButton
          label="Dismiss"
          variant="ghost"
          onClick={onDismiss}
          className="enabled:text-current"
        >
          <X className="h-4 w-4" aria-hidden />
        </IconButton>
      )}
    </div>
  );
}

export function Banners() {
  const controller = useController();
  const interrupted = useSessionStore((s) => s.interrupted);
  const setInterrupted = useSessionStore((s) => s.setInterrupted);
  const sharingStopped = useSessionStore((s) => s.sharingStopped);
  const setSharingStopped = useSessionStore((s) => s.setSharingStopped);
  const needsToken = useSessionStore((s) => s.needsAccessToken);
  const setNeedsToken = useSessionStore((s) => s.setNeedsAccessToken);
  const failed = useSessionStore((s) => s.ids.filter((id) => s.byId[id].status === 'error').length);
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  // On-device engines keep working offline; only warn when something waits for the network.
  const usesNetwork = useEngineSettings((s) => needsNetwork(s.choice, s.endpoints));
  const [token, setToken] = useState('');

  // The interruption notice clears itself after a while; listening already restarted.
  useEffect(() => {
    if (!interrupted) return;
    const t = setTimeout(() => setInterrupted(false), 8000);
    return () => clearTimeout(t);
  }, [interrupted, setInterrupted]);

  return (
    <>
      {!online && usesNetwork && (
        <Banner tone="warn" icon={<WifiOff />}>
          <span>Offline. Speech is kept and sent when the connection returns.</span>
        </Banner>
      )}
      {interrupted && (
        <Banner tone="warn" icon={<TriangleAlert />} onDismiss={() => setInterrupted(false)}>
          <span>Listening was interrupted and has restarted. Some speech may be missing.</span>
        </Banner>
      )}
      {sharingStopped && (
        <Banner tone="neutral" icon={<MonitorX />} onDismiss={() => setSharingStopped(false)}>
          <span>Tab sharing stopped, so listening is paused.</span>
          <Button size="sm" onClick={() => void controller.resume()}>
            Share again
          </Button>
        </Banner>
      )}
      {needsToken && (
        <Banner tone="accent" icon={<KeyRound />}>
          <form
            className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-2 py-1"
            onSubmit={(e) => {
              e.preventDefault();
              setAccessToken(token.trim());
              setNeedsToken(false);
              controller.queue.retryAllFailed();
            }}
          >
            <label htmlFor="access-token" className="font-medium">
              Passcode required
            </label>
            <div className="flex min-w-0 flex-1 basis-56 gap-2">
              <Input
                id="access-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="min-w-0 flex-1"
              />
              <Button type="submit" variant="primary">
                Save
              </Button>
            </div>
          </form>
        </Banner>
      )}
      {failed > 0 && !needsToken && (
        <Banner tone="danger" icon={<TriangleAlert />}>
          <span>
            {failed} {failed === 1 ? 'line' : 'lines'} failed.
          </span>
          <Button size="sm" onClick={() => controller.queue.retryAllFailed()}>
            <RotateCw className="h-4 w-4" aria-hidden /> Retry all failed
          </Button>
        </Banner>
      )}
    </>
  );
}
