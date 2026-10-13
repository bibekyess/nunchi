'use client';

import { KeyRound, RotateCw, WifiOff, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { setAccessToken } from '@/lib/api-client';
import { useSessionStore } from '@/lib/store/session-store';
import { Button } from '../ui';
import { useController } from './controller-context';

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

function Banner({ children, onDismiss }: { children: React.ReactNode; onDismiss?: () => void }) {
  return (
    <div
      className="mx-3 mt-2 flex items-center gap-3 rounded-xl bg-subtle px-4 py-2 text-sm"
      role="alert"
    >
      <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

export function Banners() {
  const controller = useController();
  const interrupted = useSessionStore((s) => s.interrupted);
  const setInterrupted = useSessionStore((s) => s.setInterrupted);
  const needsToken = useSessionStore((s) => s.needsAccessToken);
  const setNeedsToken = useSessionStore((s) => s.setNeedsAccessToken);
  const failed = useSessionStore((s) => s.ids.filter((id) => s.byId[id].status === 'error').length);
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const [token, setToken] = useState('');

  // The interruption notice clears itself after a while; listening already restarted.
  useEffect(() => {
    if (!interrupted) return;
    const t = setTimeout(() => setInterrupted(false), 8000);
    return () => clearTimeout(t);
  }, [interrupted, setInterrupted]);

  return (
    <>
      {!online && (
        <Banner>
          <WifiOff className="h-4 w-4" aria-hidden />
          <span>Offline. Speech is kept and sent when the connection returns.</span>
        </Banner>
      )}
      {interrupted && (
        <Banner onDismiss={() => setInterrupted(false)}>
          <span>Listening was interrupted and has restarted. Some speech may be missing.</span>
        </Banner>
      )}
      {needsToken && (
        <Banner>
          <KeyRound className="h-4 w-4" aria-hidden />
          <form
            className="flex flex-1 flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setAccessToken(token.trim());
              setNeedsToken(false);
              controller.queue.retryAllFailed();
            }}
          >
            <label htmlFor="access-token">Passcode required</label>
            <input
              id="access-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-background px-3 text-base"
            />
            <Button type="submit" variant="primary">
              Save
            </Button>
          </form>
        </Banner>
      )}
      {failed > 0 && !needsToken && (
        <Banner>
          <span>
            {failed} {failed === 1 ? 'line' : 'lines'} failed.
          </span>
          <Button onClick={() => controller.queue.retryAllFailed()}>
            <RotateCw className="h-4 w-4" aria-hidden /> Retry all failed
          </Button>
        </Banner>
      )}
    </>
  );
}
